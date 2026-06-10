import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INSPECTION_PHOTO_FOLDER,
  ITEM_REFERENCE_PHOTO_FOLDER,
  isAllowedCloudinaryUrl,
} from './cloudinary-url.ts';

const CLOUD = 'demo';
const base = `https://res.cloudinary.com/${CLOUD}/image/upload`;

test('accepts a valid inspection photo URL', () => {
  assert.equal(
    isAllowedCloudinaryUrl(`${base}/${INSPECTION_PHOTO_FOLDER}/abc123.jpg`, CLOUD),
    true,
  );
});

test('accepts a valid item reference photo URL', () => {
  assert.equal(
    isAllowedCloudinaryUrl(`${base}/${ITEM_REFERENCE_PHOTO_FOLDER}/scissors.webp`, CLOUD),
    true,
  );
});

test('accepts a URL with a version segment', () => {
  assert.equal(
    isAllowedCloudinaryUrl(`${base}/v1717900000/${INSPECTION_PHOTO_FOLDER}/abc.png`, CLOUD),
    true,
  );
});

test('rejects a different host', () => {
  assert.equal(
    isAllowedCloudinaryUrl(`https://evil.example.com/${CLOUD}/image/upload/${INSPECTION_PHOTO_FOLDER}/x.jpg`, CLOUD),
    false,
  );
});

test('rejects a different cloud name', () => {
  assert.equal(
    isAllowedCloudinaryUrl(`https://res.cloudinary.com/other/image/upload/${INSPECTION_PHOTO_FOLDER}/x.jpg`, CLOUD),
    false,
  );
});

test('rejects a folder that is not approved', () => {
  assert.equal(isAllowedCloudinaryUrl(`${base}/random-folder/x.jpg`, CLOUD), false);
});

test('rejects a non-image extension', () => {
  assert.equal(
    isAllowedCloudinaryUrl(`${base}/${INSPECTION_PHOTO_FOLDER}/x.svg`, CLOUD),
    false,
  );
  assert.equal(
    isAllowedCloudinaryUrl(`${base}/${INSPECTION_PHOTO_FOLDER}/x.html`, CLOUD),
    false,
  );
});

test('rejects http (non-TLS)', () => {
  assert.equal(
    isAllowedCloudinaryUrl(`http://res.cloudinary.com/${CLOUD}/image/upload/${INSPECTION_PHOTO_FOLDER}/x.jpg`, CLOUD),
    false,
  );
});

test('folder allow-list can be narrowed (item route must reject inspection folder)', () => {
  assert.equal(
    isAllowedCloudinaryUrl(`${base}/${INSPECTION_PHOTO_FOLDER}/x.jpg`, CLOUD, [ITEM_REFERENCE_PHOTO_FOLDER]),
    false,
  );
  assert.equal(
    isAllowedCloudinaryUrl(`${base}/${ITEM_REFERENCE_PHOTO_FOLDER}/x.jpg`, CLOUD, [ITEM_REFERENCE_PHOTO_FOLDER]),
    true,
  );
});

test('rejects junk input', () => {
  assert.equal(isAllowedCloudinaryUrl('', CLOUD), false);
  assert.equal(isAllowedCloudinaryUrl('not a url', CLOUD), false);
  assert.equal(isAllowedCloudinaryUrl(`${base}/${INSPECTION_PHOTO_FOLDER}/x.jpg`, ''), false);
});
