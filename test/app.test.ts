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
  SUB_ITEMS,
  TMP_FOLDER_PATH,
} from './constants';
import build from './app';
import MockTask from 'graasp-test/src/tasks/task';
import { FIXTURES_MOCK_CHILDREN_ITEMS, LIGHT_COLOR_PARENT_ITEM } from './fixtures/lightColor';

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

    jest.spyOn(runner, 'runSingle').mockImplementation(async (task) => task.result);
    jest.spyOn(runner, 'runSingleSequence').mockImplementation(async (tasks) => tasks[0].result);
  });

  it('Successfully export zip', async () => {
    const app = await build({
      taskManager,
      runner,
    });

    jest.spyOn(taskManager, 'createGetTask').mockImplementation((member, itemId) => {
      if (ITEM_FOLDER.id === itemId) return new MockTask(ITEM_FOLDER);
      SUB_ITEMS.forEach((item) => {
        if (item.id === itemId) return new MockTask(item);
      });
      return new MockTask(null);
    });
    const createGetChildrenTask = jest
      .spyOn(taskManager, 'createGetChildrenTaskSequence')
      .mockImplementation((member, itemId) => {
        if (ITEM_FOLDER.id === itemId) return [new MockTask(SUB_ITEMS)];
        else return [new MockTask([])];
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
    expect(createGetChildrenTask).toHaveBeenCalledTimes(1 + SUB_ITEMS.length);
  });
});
