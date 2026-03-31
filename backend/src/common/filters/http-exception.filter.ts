import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message =
      exception instanceof HttpException
        ? (exception.getResponse() as { message?: string | string[] })?.message ?? exception.message
        : exception instanceof Error
          ? exception.message
          : '服务器错误';

    const body = {
      code: String(status),
      message: Array.isArray(message) ? message[0] : message,
    };
    this.logger.warn(`${request.method} ${request.url} ${status}`, body);
    response.status(status).json(body);
  }
}
