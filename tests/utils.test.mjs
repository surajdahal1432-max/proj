import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePageRanges, formatPageRanges } from '../src/lib/utils.ts'

const TEN = 10
const parse = (input) => parsePageRanges(input, TEN)

test('spaced range "1 - 3" -> pages 1,2,3', () => {
  assert.deepEqual(parse('1 - 3'), [0, 1, 2])
})

test('half-spaced range "3 -5" -> pages 3,4,5', () => {
  assert.deepEqual(parse('3 -5'), [2, 3, 4])
})

test('range entirely outside the document "20-30" -> nothing', () => {
  assert.deepEqual(parse('20-30'), [])
})

test('range past the end "8-99" clamps to 8,9,10', () => {
  assert.deepEqual(parse('8-99'), [7, 8, 9])
})

test('open ended range "8-" -> 8,9,10', () => {
  assert.deepEqual(parse('8-'), [7, 8, 9])
})

test('negative index "-1" -> last page', () => {
  assert.deepEqual(parse('-1'), [9])
})

test('mixed list keeps order and removes duplicates', () => {
  assert.deepEqual(parse('1-3, 5, 8-12'), [0, 1, 2, 4, 7, 8, 9])
  assert.deepEqual(parse('3, 1, 3, 2'), [2, 0, 1])
})

test('reversed range is normalised', () => {
  assert.deepEqual(parse('5-2'), [1, 2, 3, 4])
})

test('en dash and em dash separators are accepted', () => {
  assert.deepEqual(parse('2\u20134'), [1, 2, 3])
  assert.deepEqual(parse('2\u20144'), [1, 2, 3])
})

test('semicolon separated input is accepted', () => {
  assert.deepEqual(parse('1;4;10'), [0, 3, 9])
})

test('junk and zero are ignored', () => {
  assert.deepEqual(parse('abc, 0, 2'), [1])
  assert.deepEqual(parse(''), [])
})

test('formatPageRanges compresses indices back into a readable string', () => {
  assert.equal(formatPageRanges([0, 1, 2]), '1-3')
  assert.equal(formatPageRanges([0, 2, 3, 4]), '1, 3-5')
  assert.equal(formatPageRanges([4]), '5')
  assert.equal(formatPageRanges([]), '')
})
