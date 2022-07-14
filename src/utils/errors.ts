import { StatusCodes } from 'http-status-codes';

import { BaseGraaspError } from '@graasp/sdk';

import { PLUGIN_NAME } from '../constants';

export class FileIsInvalidArchiveError extends BaseGraaspError {
  origin = PLUGIN_NAME;
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

export class InvalidFileItemError extends BaseGraaspError {
  origin = PLUGIN_NAME;
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
