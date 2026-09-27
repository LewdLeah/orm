import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { NamespacedEnums } from '@internal/contract/enum-accessor';
import type { Contract } from '@internal/contract/types';
import postgresDriver, { suppressIdleConnectionErrors } from '@internal/driver-postgres/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { sql as sqlBuilder } from '@internal/sql-builder/runtime';
import type { Db, RawLane } from '@internal/sql-builder/types';
import type { ExtractCodecTypes, SqlStorage } from '@internal/sql-contract/types';
import {
  type AnyScopeContribution,
  orm as ormBuilder,
  type PreparedFrom,
  prepareQuery,
} from '@internal/sql-orm-client';
import type { CodecTypesBase } from '@internal/sql-relational-core/expression';
import type { Preparable, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type {
  BindSiteParams,
  Declaration,
  ExecutionContext,
  ParamsFromDeclaration,
  Runtime,
  SqlExecutionStackWithDriver,
  SqlMiddleware,
  SqlRuntimeExtensionDescriptor,
  TransactionContext,
  VerifyMarkerOption,
} from '@internal/sql-runtime';
import {
  createExecutionContext,
  createSqlExecutionStack,
  withTransaction,
} from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { blindCast, castAs } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { type Client, Pool } from 'pg';
import { postgresError } from '../errors';
import { buildPostgresStaticContext } from '../static/postgres-static';
import {
  type PostgresBinding,
  type PostgresBindingInput,
  resolveOptionalPostgresBinding,
  resolvePostgresBinding,
} from './binding';
import type { NamespacedNativeEnums } from './native-enums';
import { PostgresRuntimeImpl } from './postgres-runtime';

export type PostgresTargetId = 'postgres';
type NoScopes = readonly [];
type OrmClient<
  TContract extends Contract<SqlStorage>,
  Scopes extends readonly AnyScopeContribution[] = NoScopes,
> = ReturnType<typeof ormBuilder<TContract, Record<never, never>, Scopes>>;

export interface PostgresTransactionContext<
  TContract extends Contract<SqlStorage>,
  Scopes extends readonly AnyScopeContribution[] = NoScopes,
> extends TransactionContext {
  readonly sql: Db<TContract>;
  readonly orm: OrmClient<TContract, Scopes>;
  readonly enums: NamespacedEnums<TContract>;
  readonly nativeEnums: NamespacedNativeEnums<TContract>;
}

export interface PostgresClient<
  TContract extends Contract<SqlStorage>,
  Scopes extends readonly AnyScopeContribution[] = NoScopes,
> {
  readonly sql: Db<TContract>;
  readonly orm: OrmClient<TContract, Scopes>;
  readonly enums: NamespacedEnums<TContract>;
  readonly nativeEnums: NamespacedNativeEnums<TContract>;
  readonly raw: RawLane<TContract>;
  readonly context: ExecutionContext<TContract>;
  readonly contract: TContract;
  readonly stack: SqlExecutionStackWithDriver<PostgresTargetId>;
  connect(bindingInput?: PostgresBindingInput): Promise<Runtime>;
  runtime(): Runtime;
  transaction<R>(
    fn: (tx: PostgresTransactionContext<TContract, Scopes>) => PromiseLike<R>,
  ): Promise<R>;
  prepare<
    D extends Declaration<CT>,
    Q extends SqlQueryPlan | Preparable<unknown, unknown>,
    CT extends CodecTypesBase = ExtractCodecTypes<TContract>,
  >(
    declaration: D,
    callback: (params: BindSiteParams<D>) => Q,
  ): Promise<PreparedFrom<ParamsFromDeclaration<D, CT>, Q>>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface PostgresOptionsBase<Scopes extends readonly AnyScopeContribution[] = NoScopes> {
  readonly scopes?: Scopes;
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<PostgresTargetId>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly verifyMarker?: VerifyMarkerOption;
  readonly poolOptions?: {
    readonly connectionTimeoutMillis?: number;
    readonly idleTimeoutMillis?: number;
  };
}

export interface PostgresBindingOptions {
  readonly binding?: PostgresBinding;
  readonly url?: string;
  readonly pg?: Pool | Client;
}

export type PostgresOptionsWithContract<
  TContract extends Contract<SqlStorage>,
  Scopes extends readonly AnyScopeContribution[] = NoScopes,
> = PostgresBindingOptions &
  PostgresOptionsBase<Scopes> & {
    readonly contract: TContract;
    readonly contractJson?: never;
  };

export type PostgresOptionsWithContractJson<
  TContract extends Contract<SqlStorage>,
  Scopes extends readonly AnyScopeContribution[] = NoScopes,
> = PostgresBindingOptions &
  PostgresOptionsBase<Scopes> & {
    readonly contractJson: unknown;
    readonly contract?: never;
    readonly _contract?: TContract;
  };

export type PostgresOptions<
  TContract extends Contract<SqlStorage>,
  Scopes extends readonly AnyScopeContribution[] = NoScopes,
> =
  | PostgresOptionsWithContract<TContract, Scopes>
  | PostgresOptionsWithContractJson<TContract, Scopes>;

function hasContractJson<TContract extends Contract<SqlStorage>>(
  options: PostgresOptions<TContract, readonly AnyScopeContribution[]>,
): options is PostgresOptionsWithContractJson<TContract, readonly AnyScopeContribution[]> {
  return 'contractJson' in options;
}

const contractSerializer = new PostgresContractSerializer();

function resolveContract<TContract extends Contract<SqlStorage>>(
  options: PostgresOptions<TContract, readonly AnyScopeContribution[]>,
): TContract {
  const contractJson = hasContractJson(options)
    ? options.contractJson
    : contractSerializer.serializeContract(options.contract);
  return blindCast<
    TContract,
    'validated contract JSON corresponds to the caller supplied contract type'
  >(contractSerializer.deserializeContract(contractJson));
}

function toRuntimeBinding<TContract extends Contract<SqlStorage>>(
  binding: PostgresBinding,
  options: PostgresOptions<TContract, readonly AnyScopeContribution[]>,
) {
  if (binding.kind !== 'url') {
    return binding;
  }

  return {
    kind: 'pgPool',
    pool: suppressIdleConnectionErrors(
      new Pool({
        connectionString: binding.url,
        connectionTimeoutMillis: options.poolOptions?.connectionTimeoutMillis ?? 20_000,
        idleTimeoutMillis: options.poolOptions?.idleTimeoutMillis ?? 30_000,
      }),
    ),
  } as const;
}

/**
 * Creates a lazy Postgres client from either `contractJson` or a TypeScript-authored `contract`.
 * Static query surfaces are available immediately, while `runtime()` instantiates the driver/pool on first call.
 *
 * - No-emit: pass a TypeScript-authored contract. Example: postgres({ contract })
 * - Emitted: pass Contract type explicitly. Example: postgres<Contract>({ contractJson, url })
 */
export default function postgres<
  TContract extends Contract<SqlStorage>,
  const Scopes extends readonly AnyScopeContribution[] = NoScopes,
>(options: PostgresOptionsWithContract<TContract, Scopes>): PostgresClient<TContract, Scopes>;
export default function postgres<
  TContract extends Contract<SqlStorage>,
  const Scopes extends readonly AnyScopeContribution[] = NoScopes,
>(options: PostgresOptionsWithContractJson<TContract, Scopes>): PostgresClient<TContract, Scopes>;
export default function postgres<
  TContract extends Contract<SqlStorage>,
  const Scopes extends readonly AnyScopeContribution[] = NoScopes,
>(options: PostgresOptions<TContract, Scopes>): PostgresClient<TContract, Scopes> {
  const contract = resolveContract(options);
  let binding = resolveOptionalPostgresBinding(options);

  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: options.extensions ?? [],
  });

  const context = createExecutionContext<TContract, PostgresTargetId>({
    contract,
    stack,
    driver: postgresDriver,
  });
  const {
    sql,
    raw: rawSqlTag,
    enums,
    nativeEnums,
  } = buildPostgresStaticContext<TContract>(context, stack.adapter.rawCodecInferer);

  let runtimeInstance: Runtime | undefined;
  let runtimeDriver: { connect(binding: unknown): Promise<void> } | undefined;
  let driverConnected = false;
  let connectPromise: Promise<void> | undefined;
  let backgroundConnectError: unknown;
  let closed = false;
  let ownedDispose: (() => Promise<void>) | undefined;

  const connectDriver = async (resolvedBinding: PostgresBinding): Promise<void> => {
    if (driverConnected) return;
    if (!runtimeDriver) throw new InternalError('Postgres runtime driver missing');
    if (connectPromise) return connectPromise;
    const runtimeBinding = toRuntimeBinding(resolvedBinding, options);
    if (resolvedBinding.kind === 'url' && runtimeBinding.kind === 'pgPool') {
      const pool = runtimeBinding.pool;
      let disposed = false;
      ownedDispose = async () => {
        if (disposed) return;
        disposed = true;
        await pool.end().then(() => undefined);
      };
    }
    connectPromise = runtimeDriver
      .connect(runtimeBinding)
      .then(() => {
        driverConnected = true;
      })
      .catch(async (err) => {
        backgroundConnectError = err;
        connectPromise = undefined;
        await ownedDispose?.().catch(() => undefined);
        throw err;
      });
    return connectPromise;
  };

  const getRuntime = (): Runtime => {
    if (closed) {
      throw postgresError('DRIVER.NOT_CONNECTED', 'Postgres client is closed', {
        why: 'close() was called on this client.',
        fix: 'Create a new postgres(...) client.',
        meta: { extension: 'postgres' },
      });
    }

    if (backgroundConnectError !== undefined) {
      throw backgroundConnectError;
    }

    if (runtimeInstance) {
      return runtimeInstance;
    }

    const stackInstance = instantiateExecutionStack(stack);
    const driverDescriptor = stack.driver;
    if (!driverDescriptor) {
      throw new InternalError('Driver descriptor missing from execution stack');
    }

    const driver = driverDescriptor.create({
      cursor: { disabled: true },
    });
    runtimeDriver = driver;
    if (binding !== undefined) {
      void connectDriver(binding).catch(() => undefined);
    }

    runtimeInstance = new PostgresRuntimeImpl({
      context,
      adapter: stackInstance.adapter,
      driver,
      ...ifDefined('verifyMarker', options.verifyMarker),
      ...ifDefined('middleware', options.middleware),
    });

    return runtimeInstance;
  };

  const scopes = blindCast<Scopes, 'absent scopes mean the empty default'>(options.scopes ?? []);
  const orm: OrmClient<TContract, Scopes> = ormBuilder({
    scopes,
    runtime: {
      query(plan) {
        return getRuntime().query(plan);
      },
      execute(plan) {
        return getRuntime().execute(plan);
      },
      connection() {
        return getRuntime().connection();
      },
    },
    context,
  });

  function prepare<
    D extends Declaration<CT>,
    Q extends SqlQueryPlan | Preparable<unknown, unknown>,
    CT extends CodecTypesBase = ExtractCodecTypes<TContract>,
  >(
    declaration: D,
    callback: (params: BindSiteParams<D>) => Q,
  ): Promise<PreparedFrom<ParamsFromDeclaration<D, CT>, Q>> {
    return prepareQuery<D, Q, CT>(getRuntime(), declaration, callback);
  }

  return {
    sql,
    orm,
    enums,
    nativeEnums,
    raw: rawSqlTag,
    context,
    contract,
    stack,

    async connect(bindingInput) {
      if (closed) {
        throw postgresError('DRIVER.NOT_CONNECTED', 'Postgres client is closed', {
          why: 'close() was called on this client.',
          fix: 'Create a new postgres(...) client.',
          meta: { extension: 'postgres' },
        });
      }

      if (driverConnected || connectPromise) {
        throw postgresError('DRIVER.ALREADY_CONNECTED', 'Postgres client already connected', {
          fix: 'Call connect() at most once per client.',
          meta: { extension: 'postgres' },
        });
      }

      if (bindingInput !== undefined) {
        binding = resolvePostgresBinding(bindingInput);
      }

      if (binding === undefined) {
        throw postgresError(
          'RUNTIME.BINDING_MISSING',
          'Postgres binding not configured. Pass url/pg/binding to postgres(...) or call db.connect({ ... }).',
          { meta: { extension: 'postgres' } },
        );
      }

      const runtime = getRuntime();
      if (driverConnected) {
        return runtime;
      }

      await connectDriver(binding);
      return runtime;
    },

    runtime() {
      return getRuntime();
    },

    prepare,

    transaction<R>(
      fn: (tx: PostgresTransactionContext<TContract, Scopes>) => PromiseLike<R>,
    ): Promise<R> {
      return withTransaction(getRuntime(), (txCtx) => {
        const rawCodecInferer = stack.adapter.rawCodecInferer;
        const txSql: Db<TContract> = sqlBuilder<TContract>({
          context,
          rawCodecInferer,
        });

        const txOrm: OrmClient<TContract, Scopes> = ormBuilder({
          scopes,
          runtime: {
            query(plan) {
              return txCtx.query(plan);
            },
            execute(plan) {
              return txCtx.execute(plan);
            },
          },
          context,
        });

        // Use `txCtx` as the prototype instead of spreading it so that live
        // accessors (notably the `invalidated` getter, which reads a closure
        // variable in `withTransaction`) remain wired to the original object.
        // Spreading would evaluate the getter once and freeze its value.
        const tx: PostgresTransactionContext<TContract, Scopes> = Object.assign(
          castAs<TransactionContext>(Object.create(txCtx)),
          { sql: txSql, orm: txOrm, enums, nativeEnums },
        );

        return fn(tx);
      });
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await connectPromise?.catch(() => undefined);
      await ownedDispose?.();
    },

    [Symbol.asyncDispose](): Promise<void> {
      return this.close();
    },
  };
}
