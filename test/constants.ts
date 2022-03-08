import { ItemType } from '../src/constants';

export const FIXTURE_LIGHT_COLOR_ZIP_PATH = './fixtures/lightColor.zip';

export const FIXTURE_IMAGE_PATH = './fixtures/img.png';
export const TMP_FOLDER_PATH = './test/tmp';

export const SRC_FOLDER_PATH = '../src';
const BASE_ITEM = {
  id: 'ecafbd2a-5688-11eb-ae93-0242ac130002',
  name: 'parent_public_item',
  path: 'ecafbd2a_5688_11eb_ae93_0242ac130002',
  description: 'parent item of two public items',
  creator: 'Louise',
  createdAt: '2022-02-12',
  updatedAt: '2022-02-12',
  settings: null,
  extra: null,
};
export const ITEM_FOLDER = {
  ...BASE_ITEM,
  type: ItemType.FOLDER,
};
export const ITEM_DOCUMENT = {
  ...BASE_ITEM,
  type: ItemType.DOCUMENT,
};
export const ITEM_LINK = {
  ...BASE_ITEM,
  type: ItemType.LINK,
};
export const ITEM_APP = {
  ...BASE_ITEM,
  type: ItemType.APP,
};
export const SUB_ITEMS = [
  {
    id: 'fdf09f5a-5688-11eb-ae93-0242ac130004',
    name: 'public_item1',
    path: 'ecafbd2a_5688_11eb_ae93_0242ac130002.fdf09f5a_5688_11eb_ae93_0242ac130004',
    type: ItemType.FOLDER,
  },
  {
    id: 'fdf09f5a-5688-11eb-ae93-0242ac130003',
    name: 'public_item2',
    path: 'ecafbd2a_5688_11eb_ae93_0242ac130002.fdf09f5a_5688_11eb_ae93_0242ac130003',
    type: ItemType.FOLDER,
  },
];
