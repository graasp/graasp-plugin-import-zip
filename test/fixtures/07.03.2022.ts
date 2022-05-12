import { Item } from 'graasp';

import { ItemType } from '../../src/constants';

export const FIXTURE_DOT_PARENT_ITEM = { name: '07.03.2022', type: ItemType.FOLDER };

export const FIXTURE_DOT_ITEMS: Partial<Item>[] = [FIXTURE_DOT_PARENT_ITEM];

export const FIXTURES_DOT_CHILDREN_ITEMS = [
  { name: 'Documents ressource', type: ItemType.FOLDER },
  { name: 'Support de cours', type: ItemType.FOLDER },
];
