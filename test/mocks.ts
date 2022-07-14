import { Actor, Item, Task } from '@graasp/sdk';
import { ItemTaskManager, Task as MockTask } from 'graasp-test';

export const mockCreateGetTaskSequence = ({ itemTaskManager, parentItem, subItems }) => {
  return jest
    .spyOn(itemTaskManager, 'createGetTaskSequence')
    .mockImplementation((member, itemId) => {
      if (parentItem?.id === itemId) return [new MockTask(parentItem)];
      subItems?.forEach((item) => {
        if (item.id === itemId) return [new MockTask(item)];
      });
      return [new MockTask(null)];
    });
};

export const mockCreateGetChildrenTaskSequence = ({ itemTaskManager, parentItem, subItems }) => {
  return jest
    .spyOn(itemTaskManager, 'createGetChildrenTaskSequence')
    .mockImplementation((member, itemId) => {
      if (parentItem.id === itemId) return [new MockTask(subItems)];
      else return [new MockTask([])];
    });
};

export const mockCreateGetChildrenTask = ({
  itemTaskManager,
  parentItem,
  subItems,
}: {
  itemTaskManager: ItemTaskManager;
  parentItem?: Item;
  subItems?: Item[];
}) => {
  return jest
    .spyOn(itemTaskManager, 'createGetChildrenTask')
    .mockImplementation((_member, { item }) => {
      if (parentItem?.id === item.id) return new MockTask(subItems);
      else return new MockTask([]);
    });
};

export const mockRunSingle = ({ runner, task }) => {
  jest.spyOn(runner, 'runSingle').mockImplementation(async (t) => {
    if (task === t) {
      throw Error('file not found');
    } else {
      return (t as Task<Actor, unknown>).result;
    }
  });
};
