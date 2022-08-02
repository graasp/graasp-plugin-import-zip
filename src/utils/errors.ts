import { StatusCodes } from 'http-status-codes';

import { ErrorFactory } from '@graasp/sdk';

import { PLUGIN_NAME } from '../constants';

export const GraaspItemZipError = ErrorFactory(PLUGIN_NAME);

export class FileIsInvalidArchiveError extends GraaspItemZipError {
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

export class InvalidFileItemError extends GraaspItemZipError {
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
