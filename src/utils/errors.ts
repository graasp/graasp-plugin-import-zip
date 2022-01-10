import { GraaspErrorDetails, GraaspError } from 'graasp';
import { StatusCodes } from 'http-status-codes';

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

export class FileIsNotAValidArchiveError extends GraaspImportZipError {
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

export class InvalidArchiveStructureError extends GraaspImportZipError {
  constructor(data?: unknown) {
    super(
      {
        code: 'GPIZERR002',
        statusCode: StatusCodes.BAD_REQUEST,
        message: 'Zip structure is invalid',
      },
      data,
    );
  }
}