import { readdirSync, createReadStream, existsSync } from 'fs';
import FormData from 'form-data';
import { v4 } from 'uuid';
import { ItemTaskManager, TaskRunner } from 'graasp-test';
import { StatusCodes } from 'http-status-codes';
import path from 'path';
import {
  FIXTURE_IMAGE_PATH,
  FIXTURE_LIGHT_COLOR_ZIP_PATH,
  ITEM_FOLDER,
  NON_EXISTING_FILE,
  SUB_ITEMS,
  TMP_FOLDER_PATH,
} from './constants';
import build, { DEFAULT_OPTIONS } from './app';
import MockTask from 'graasp-test/src/tasks/task';
import { FIXTURES_MOCK_CHILDREN_ITEMS, LIGHT_COLOR_PARENT_ITEM } from './fixtures/lightColor';
import { FileTaskManager, ServiceMethod } from 'graasp-plugin-file';
import { ItemType } from '../src/constants';
import plugin from '../src/service-api';
import {
  mockCreateGetChildrenTaskSequence,
  mockCreateGetTaskSequence,
  mockRunSingle,
} from './mocks';

const taskManager = new ItemTaskManager();
const runner = new TaskRunner();

describe('Import Zip', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(runner, 'runSingle').mockImplementation(async () => true);
    jest.spyOn(runner, 'runSingleSequence').mockImplementation(async () => true);
    jest.spyOn(runner, 'runMultipleSequences').mockImplementation(async (tasks) => {
      // first level
      if (tasks.length === 3) {
        return FIXTURES_MOCK_CHILDREN_ITEMS;
      }
      // parent level
      if (tasks.length === 1) {
        return [LIGHT_COLOR_PARENT_ITEM];
      }
      return [];
    });
  });

  describe('/zip-import', () => {
    it('Successfully import zip', async () => {
      const app = await build({
        plugin,
        taskManager,
        runner,
      });

      const createItemTask = jest
        .spyOn(taskManager, 'createCreateTaskSequence')
        .mockReturnValue([new MockTask(true)]);
      jest.spyOn(taskManager, 'createUpdateTaskSequence').mockReturnValue([new MockTask(true)]);

      const form = new FormData();
      const filepath = path.resolve(__dirname, FIXTURE_LIGHT_COLOR_ZIP_PATH);
      form.append('file', createReadStream(filepath));
      form.append('file', createReadStream(filepath));

      const res = await app.inject({
        method: 'POST',
        url: '/zip-import',
        payload: form,
        headers: form.getHeaders(),
      });

      expect(res.statusCode).toBe(StatusCodes.OK);
      // file is deleted
      try {
        if (existsSync(TMP_FOLDER_PATH)) {
          // file is deleted
          const files = readdirSync(TMP_FOLDER_PATH);
          expect(files.length).toBeFalsy();
        }
      } catch (err) {
        // don't check if folder doesn't exist
      }

      // recursively handle zip content
      expect(createItemTask).toHaveBeenCalledTimes(1 + FIXTURES_MOCK_CHILDREN_ITEMS.length);
    });

    it('Successfully import zip in parent', async () => {
      const app = await build({
        plugin,
        taskManager,
        runner,
      });

      const id = v4();
      const createItemTask = jest
        .spyOn(taskManager, 'createCreateTaskSequence')
        .mockImplementation((_member, item, parentId) => {
          // check first create task set parent to given parent id
          if (item.name === LIGHT_COLOR_PARENT_ITEM.name) {
            expect(parentId).toEqual(id);
          }
          return [new MockTask(true)];
        });
      jest.spyOn(taskManager, 'createUpdateTaskSequence').mockReturnValue([new MockTask(true)]);

      const form = new FormData();
      const filepath = path.resolve(__dirname, FIXTURE_LIGHT_COLOR_ZIP_PATH);
      form.append('file', createReadStream(filepath));
      form.append('file', createReadStream(filepath));

      const res = await app.inject({
        method: 'POST',
        url: `/zip-import?parentId=${id}`,
        payload: form,
        headers: form.getHeaders(),
      });

      expect(res.statusCode).toBe(StatusCodes.OK);

      try {
        if (existsSync(TMP_FOLDER_PATH)) {
          // file is deleted
          const files = readdirSync(TMP_FOLDER_PATH);
          expect(files.length).toBeFalsy();
        }
      } catch (err) {
        // don't check if folder doesn't exist
      }

      // recursively handle zip content
      expect(createItemTask).toHaveBeenCalledTimes(1 + FIXTURES_MOCK_CHILDREN_ITEMS.length);
    });

    it('Throw if file is not a zip archive', async () => {
      const app = await build({
        plugin,
        taskManager,
        runner,
      });

      const form = new FormData();
      const filepath = path.resolve(__dirname, FIXTURE_IMAGE_PATH);
      form.append('file', createReadStream(filepath));
      form.append('file', createReadStream(filepath));

      const res = await app.inject({
        method: 'POST',
        url: '/zip-import',
        payload: form,
        headers: form.getHeaders(),
      });

      expect(res.statusCode).toBe(StatusCodes.BAD_REQUEST);
    });
  });
});

describe('Export Zip', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const getFileTask = new MockTask(null);
    mockRunSingle({ runner, task: getFileTask });
    jest.spyOn(runner, 'runSingleSequence').mockImplementation(async (tasks) => tasks[0].result);
  });

  it('Successfully export zip', async () => {
    const app = await build({
      plugin,
      taskManager,
      runner,
    });

    const parentItem = ITEM_FOLDER;
    const subItems = SUB_ITEMS;

    mockCreateGetTaskSequence({
      itemTaskManager: taskManager,
      parentItem,
      subItems,
    });
    const createGetChildrenTask = mockCreateGetChildrenTaskSequence({
      itemTaskManager: taskManager,
      parentItem,
      subItems,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/zip-export/${ITEM_FOLDER.id}`,
      headers: new FormData().getHeaders(),
    });
    expect(res.statusCode).toBe(StatusCodes.OK);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toBe(`filename="${ITEM_FOLDER.name}.zip"`);
    expect(res.rawPayload).toBeTruthy();
    expect(res.headers['content-length']).not.toBe('0');

    // recursively handle zip content
    expect(createGetChildrenTask).toHaveBeenCalledTimes(
      1 + SUB_ITEMS.filter((item) => item.type === ItemType.FOLDER).length,
    );
  });

  // TODO
  it('Item not found on unexisting item', async () => {
    const app = await build({
      plugin,
      taskManager,
      runner,
    });

    jest
      .spyOn(taskManager, 'createGetTaskSequence')
      .mockImplementation(() => [new MockTask(NON_EXISTING_FILE)]);
    const fileTaskManager = new FileTaskManager(
      DEFAULT_OPTIONS.serviceOptions,
      ServiceMethod.LOCAL,
    );

    jest.spyOn(fileTaskManager, 'createDownloadFileTask').mockImplementation(() => {
      throw Error('file not found');
    });

    const res = await app.inject({
      method: 'GET',
      url: `/zip-export/${NON_EXISTING_FILE.id}`,
      headers: new FormData().getHeaders(),
    });

    expect(false).toBeTruthy();
  });

  it('Throw if file not found', async () => {
    const app = await build({
      plugin,
      taskManager,
      runner,
    });

    jest
      .spyOn(taskManager, 'createGetTaskSequence')
      .mockImplementation(() => [new MockTask(NON_EXISTING_FILE)]);
    const fileTaskManager = new FileTaskManager(
      DEFAULT_OPTIONS.serviceOptions,
      ServiceMethod.LOCAL,
    );

    jest.spyOn(fileTaskManager, 'createDownloadFileTask').mockImplementation(() => {
      throw Error('file not found');
    });

    const res = await app.inject({
      method: 'GET',
      url: `/zip-export/${NON_EXISTING_FILE.id}`,
      headers: new FormData().getHeaders(),
    });
    expect(res.statusCode).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
  });
});
