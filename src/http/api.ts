import "reflect-metadata";
import { resolve } from "node:path";
import {
  ArgumentsHost,
  Body,
  CanActivate,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  Headers,
  HttpException,
  Inject,
  Injectable,
  Module,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Response } from "express";
import { ApplicationError, dbCode } from "../application/contracts";
import { DomainError } from "../domain/money";
import type { Runtime } from "../runtime";
export const RUNTIME = Symbol("runtime");
/** Extension point: replace with an external OIDC provider guard and provider authorization. */
@Injectable()
export class LocalOnlyAuthGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
@Catch()
class ErrorFilter implements ExceptionFilter {
  constructor(private readonly runtime: Runtime) {}
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      error instanceof ApplicationError
        ? error.httpStatus
        : error instanceof DomainError
          ? 400
          : error instanceof HttpException
            ? error.getStatus()
            : 503;
    const code =
      error instanceof ApplicationError || error instanceof DomainError
        ? error.code
        : status === 503
          ? "INFRASTRUCTURE_UNAVAILABLE"
          : status === 404
            ? "NOT_FOUND"
            : "INVALID_REQUEST";
    if (status >= 500)
      this.runtime.telemetry.log("http_unavailable", {
        correlationId: response.getHeader("x-correlation-id")?.toString(),
        code: dbCode(error),
      });
    response.status(status).json({ code, retryable: status === 503 });
  }
}
@Controller()
@UseGuards(LocalOnlyAuthGuard)
class FinancialController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}
  @Post("wallets") open(@Body() body: unknown) {
    return this.runtime.processor.open(body);
  }
  @Get("wallets/:id") wallet(@Param("id") id: string) {
    return this.runtime.queries.wallet(id);
  }
  @Get("wallets/:id/ledger") ledger(
    @Param("id") id: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.runtime.queries.ledger(id, cursor, limit);
  }
  @Post("wallets/:id/reconciliation") async reconcile(
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    response.status(200).json(await this.runtime.queries.reconcile(id));
  }
  @Get("wagering/transactions/:id") transaction(@Param("id") id: string) {
    return this.runtime.queries.transaction(id);
  }
  @Get("providers/:provider/wagering/transactions/:external") external(
    @Param("provider") provider: string,
    @Param("external") external: string,
  ) {
    return this.runtime.queries.external(provider, external);
  }
  @Post("wagering/transactions") async submit(
    @Body() body: unknown,
    @Headers("idempotency-key") key: unknown,
    @Res() response: Response,
  ) {
    if (key === undefined) throw new ApplicationError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const result = await this.runtime.processor.execute(body, key, {
      correlationId: response.getHeader("x-correlation-id")!.toString(),
    });
    response
      .status(
        result.status === "REJECTED"
          ? 422
          : result.status === "FAILED"
            ? 500
            : result.status.startsWith("PENDING")
              ? 202
              : 200,
      )
      .json(result);
  }
}
@Controller()
class OperationalController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}
  @Get("health/live") live() {
    return { status: "alive" };
  }
  @Get("health/ready") async ready() {
    await this.runtime.orm.em.getConnection().execute("SELECT 1");
    await this.runtime.sqs.ready();
    return { status: "ready" };
  }
  @Get("metrics") async metrics(@Res() response: Response) {
    response
      .type(this.runtime.telemetry.registry.contentType)
      .send(await this.runtime.telemetry.registry.metrics());
  }
}
@Controller("dashboard")
@UseGuards(LocalOnlyAuthGuard)
class DashboardController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}
  @Get("overview") overview(@Query() query: unknown) {
    return this.runtime.dashboard.overview(query);
  }
  @Get("wallets") wallets(@Query() query: unknown) {
    return this.runtime.dashboard.list("wallets", query);
  }
  @Get("transactions") transactions(@Query() query: unknown) {
    return this.runtime.dashboard.list("transactions", query);
  }
  @Get("operations") operations() {
    return this.runtime.dashboard.operations();
  }
  @Get("health") async health() {
    const results = await Promise.allSettled([
      this.runtime.orm.em.getConnection().execute("SELECT 1"),
      this.runtime.sqs.ready(),
    ]);
    return {
      api: true,
      postgres: results[0].status === "fulfilled",
      sqs: results[1].status === "fulfilled",
      checkedAt: new Date().toISOString(),
    };
  }
}
export async function createApp(runtime: Runtime) {
  @Module({
    controllers: [FinancialController, OperationalController, DashboardController],
    providers: [LocalOnlyAuthGuard, { provide: RUNTIME, useValue: runtime }],
  })
  class AppModule {}
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  app.useStaticAssets(resolve(process.cwd(), "public"), { maxAge: 0, index: "index.html" });
  app.use(
    (
      _req: { headers: Record<string, string | undefined> },
      response: Response,
      next: () => void,
    ) => {
      const incoming = _req.headers["x-correlation-id"];
      response.setHeader(
        "x-correlation-id",
        incoming && /^[A-Za-z0-9_.:-]{1,128}$/.test(incoming) ? incoming : crypto.randomUUID(),
      );
      next();
    },
  );
  app.useGlobalFilters(new ErrorFilter(runtime));
  return app;
}
