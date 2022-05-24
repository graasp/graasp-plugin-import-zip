import { StatusCodes } from 'http-status-codes';

import { GraaspError, GraaspErrorDetails } from 'graasp';

export class GraaspImportZipError implements GraaspError {
  name: string;
  code: string;
  message: string;
  statusCode?: number;
  data?: unknown;
  origin: 'plugin' | string;

  constructor({ code, statusCode, message }: GraaspErrorDetails, data?: unknown) {
    this.name = code;
    this.code = code;
    this.message = message;
    this.statusCode = statusCode;
    this.data = data;
    this.origin = 'plugin';
  }
}

export class FileIsInvalidArchiveError extends GraaspImportZipError {
  constructor(data?: unknown) {
    super(
      {
        code: 'GPIZERR001',
        statusCode: StatusCodes.BAD_REQUEST,
        message: 'File is not a zip archive',
      },
      data,
    );
  }
}

export class InvalidFileItemError extends GraaspImportZipError {
  constructor(data?: unknown) {
    super(
      {
        code: 'GPIZERR003',
        statusCode: StatusCodes.BAD_REQUEST,
        message: 'File properties are invalid.',
      },
      data,
    );
  }
}
