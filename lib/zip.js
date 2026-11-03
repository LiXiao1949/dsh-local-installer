'use strict'

/**
 * A dependency-free zip reader.
 *
 * The installer must work with no network and no extra packages, so the pieces
 * of the format it needs are parsed here: the end-of-central-directory record,
 * the central directory, and each entry's local header. Compression methods 0
 * (stored) and 8 (deflate) are supported — the ones every zip tool produces for
 * a plugin folder.
 */

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const EOCD_SIGNATURE = 0x06054b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

const MAX_ENTRIES = 20000
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024

function findEndOfCentralDirectory(buffer) {
  const lowest = Math.max(0, buffer.length - 65557)
  for (let offset = buffer.length - 22; offset >= lowest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  return -1
}

function readUInt64(buffer, offset) {
  const value = buffer.readBigUInt64LE(offset)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('zip 字段超出可处理范围')
  return Number(value)
}

/** Locate the central directory, handling the zip64 records when present. */
function readDirectoryRecord(buffer) {
  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd < 0) throw new Error('不是有效的 zip 文件（找不到中央目录结尾记录）')
  let count = buffer.readUInt16LE(eocd + 10)
  let size = buffer.readUInt32LE(eocd + 12)
  let offset = buffer.readUInt32LE(eocd + 16)

  const needsZip64 = count === 0xffff || size === 0xffffffff || offset === 0xffffffff
  if (needsZip64) {
    const locator = eocd - 20
    if (locator >= 0 && buffer.readUInt32LE(locator) === ZIP64_LOCATOR_SIGNATURE) {
      const zip64Offset = readUInt64(buffer, locator + 8)
      if (zip64Offset + 56 <= buffer.length && buffer.readUInt32LE(zip64Offset) === ZIP64_EOCD_SIGNATURE) {
        count = readUInt64(buffer, zip64Offset + 32)
        size = readUInt64(buffer, zip64Offset + 40)
        offset = readUInt64(buffer, zip64Offset + 48)
      }
    }
  }
  if (!Number.isFinite(count) || !Number.isFinite(size) || !Number.isFinite(offset)) {
    throw new Error('zip 中央目录记录损坏')
  }
  if (offset + size > buffer.length) throw new Error('zip 中央目录超出文件范围')
  return { count, size, offset }
}

/**
 * Parse every entry in the archive.
 * @returns {{ name: string, directory: boolean, method: number, compressedSize: number, size: number, localOffset: number, utf8: boolean }[]}
 */
function readEntries(buffer) {
  const { count, offset } = readDirectoryRecord(buffer)
  if (count > MAX_ENTRIES) throw new Error(`zip 内文件过多（${count} 个），可能不是插件包`)
  const entries = []
  let pointer = offset
  let totalUncompressed = 0
  for (let index = 0; index < count; index += 1) {
    if (pointer + 46 > buffer.length) throw new Error('zip 中央目录条目被截断')
    if (buffer.readUInt32LE(pointer) !== CENTRAL_SIGNATURE) throw new Error('zip 中央目录条目签名错误')
    const flags = buffer.readUInt16LE(pointer + 8)
    const method = buffer.readUInt16LE(pointer + 10)
    const compressedSize = buffer.readUInt32LE(pointer + 20)
    const size = buffer.readUInt32LE(pointer + 24)
    const nameLength = buffer.readUInt16LE(pointer + 28)
    const extraLength = buffer.readUInt16LE(pointer + 30)
    const commentLength = buffer.readUInt16LE(pointer + 32)
    const localOffset = buffer.readUInt32LE(pointer + 42)
    const nameStart = pointer + 46
    const nameEnd = nameStart + nameLength
    if (nameEnd > buffer.length) throw new Error('zip 条目文件名被截断')
    const name = buffer.toString('utf8', nameStart, nameEnd)
    pointer = nameEnd + extraLength + commentLength
    if (flags & 0x0001) throw new Error(`zip 条目已加密，无法解压：${name}`)
    totalUncompressed += size
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw new Error('zip 解压后体积过大')
    entries.push({
      name,
      directory: name.endsWith('/') || name.endsWith('\\'),
      method,
      compressedSize,
      size,
      localOffset,
      utf8: (flags & 0x0800) !== 0,
    })
  }
  return entries
}

/** Slice one entry's compressed payload out of the archive. */
function readEntryData(buffer, entry) {
  const header = entry.localOffset
  if (header + 30 > buffer.length) throw new Error(`zip 条目头部越界：${entry.name}`)
  if (buffer.readUInt32LE(header) !== LOCAL_SIGNATURE) throw new Error(`zip 条目头部签名错误：${entry.name}`)
  const nameLength = buffer.readUInt16LE(header + 26)
  const extraLength = buffer.readUInt16LE(header + 28)
  const start = header + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (end > buffer.length) throw new Error(`zip 条目数据越界：${entry.name}`)
  return buffer.subarray(start, end)
}

function decompress(buffer, entry) {
  const data = readEntryData(buffer, entry)
  if (entry.method === 0) return data
  if (entry.method === 8) return zlib.inflateRawSync(data)
  throw new Error(`zip 条目使用了不支持的压缩方式 ${entry.method}：${entry.name}`)
}

/** Resolve an entry name inside `target`, refusing absolute paths and `..` escapes. */
function safeJoin(target, name) {
  const normalized = name.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`zip 条目使用了绝对路径：${name}`)
  }
  const resolved = path.resolve(target, normalized)
  const prefix = target.endsWith(path.sep) ? target : target + path.sep
  if (resolved !== target && !resolved.startsWith(prefix)) {
    throw new Error(`zip 条目试图写到目标目录之外：${name}`)
  }
  return resolved
}

/** Read one entry as UTF-8 text without extracting the archive. */
function readTextEntry(buffer, entry) {
  return decompress(buffer, entry).toString('utf8')
}

/**
 * Extract the whole archive into `target`.
 * @returns {{ files: number, bytes: number }}
 */
function extractInto(buffer, entries, target) {
  let files = 0
  let bytes = 0
  for (const entry of entries) {
    const destination = safeJoin(target, entry.name)
    if (entry.directory) {
      fs.mkdirSync(destination, { recursive: true })
      continue
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    const content = entry.size === 0 ? Buffer.alloc(0) : decompress(buffer, entry)
    if (content.length !== entry.size && entry.method !== 0) {
      // Not fatal: some writers omit sizes. Keeping the inflated bytes is the
      // correct behaviour either way.
    }
    fs.writeFileSync(destination, content)
    files += 1
    bytes += content.length
  }
  return { files, bytes }
}

module.exports = { readEntries, extractInto, readTextEntry, safeJoin }
