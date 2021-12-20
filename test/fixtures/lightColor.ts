import { Item } from 'graasp';
import { ItemType } from '../../src/constants';

export const LIGHT_COLOR_PARENT_ITEM = { name: 'Light Color', type: ItemType.FOLDER };

export const LIGHT_COLOR_ITEMS: Partial<Item>[] = [LIGHT_COLOR_PARENT_ITEM];

export const FIXTURES_MOCK_CHILDREN_ITEMS = [
  { name: 'About', type: ItemType.FOLDER },
  { name: 'Colour of objects', type: ItemType.FOLDER },
  { name: 'Mixing Colours', type: ItemType.FOLDER },
  { name: 'Visible Light', type: ItemType.FOLDER },
  { name: 'White Light', type: ItemType.FOLDER },
];
