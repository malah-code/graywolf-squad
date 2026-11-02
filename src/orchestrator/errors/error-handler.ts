import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { GraywolfAppError } from './taxonomy';

export function createGlobalErrorHandler() {
  return function globalErrorHandler(
    error: FastifyError | GraywolfAppError | Error,
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const timestamp = new Date().toISOString();

    // 1. Domain-specific GraywolfAppError
    if (error instanceof GraywolfAppError) {
      request.log.warn(
        { code: error.code, httpStatus: error.httpStatus, details: error.details },
        `[${error.code}] ${error.message}`
      );
      return reply.status(error.httpStatus).send(error.toJSON());
    }

    // 2. Fastify schema validation errors
    if ('validation' in error && error.validation) {
      request.log.warn({ validation: error.validation }, 'Fastify schema validation failed');
      return reply.status(400).send({
        code: 'ACI_VALIDATION_FAILED',
        message: error.message || 'Validation failed for request parameters or payload',
        details: { validation: error.validation },
        retryable: true,
        timestamp,
      });
    }

    // 3. Fallback for unhandled/internal errors
    const statusCode = ('statusCode' in error && typeof error.statusCode === 'number')
      ? error.statusCode
      : 500;

    request.log.error(error, `Unhandled exception encountered: ${error.message}`);

    const isProduction = process.env.NODE_ENV === 'production';
    const message = isProduction && statusCode === 500
      ? 'An unexpected internal error occurred'
      : error.message || 'Internal server error';

    return reply.status(statusCode).send({
      code: 'INTERNAL_SERVER_ERROR',
      message,
      details: isProduction ? {} : { stack: error.stack },
      retryable: false,
      timestamp,
    });
  };
}
