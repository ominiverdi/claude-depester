/**
 * Bun binary extraction and repacking utilities
 * Based on tweakcc's approach - proper Bun binary structure handling
 *
 * @author Lorenzo Becchi
 * @license MIT
 */

const LIEF = require('node-lief');

// Bun trailer that marks the end of embedded data
const BUN_TRAILER = Buffer.from('\n---- Bun! ----\n');

// Size constants for binary structures
const SIZEOF_OFFSETS = 32;
const SIZEOF_STRING_POINTER = 8;
const SIZEOF_MODULE = 4 * SIZEOF_STRING_POINTER + 4;

/**
 * Parse a StringPointer from buffer at offset
 */
function parseStringPointer(buffer, offset) {
  return {
    offset: buffer.readUInt32LE(offset),
    length: buffer.readUInt32LE(offset + 4),
  };
}

/**
 * Get content from buffer using StringPointer
 */
function getStringPointerContent(buffer, stringPointer) {
  return buffer.subarray(
    stringPointer.offset,
    stringPointer.offset + stringPointer.length
  );
}

/**
 * Parse BunOffsets structure
 */
function parseOffsets(buffer) {
  let pos = 0;
  const byteCount = buffer.readBigUInt64LE(pos);
  pos += 8;
  const modulesPtr = parseStringPointer(buffer, pos);
  pos += 8;
  const entryPointId = buffer.readUInt32LE(pos);
  pos += 4;
  const compileExecArgvPtr = parseStringPointer(buffer, pos);
  
  return { byteCount, modulesPtr, entryPointId, compileExecArgvPtr };
}

/**
 * Parse a compiled module from buffer
 */
function parseCompiledModule(buffer, offset) {
  let pos = offset;
  const name = parseStringPointer(buffer, pos);
  pos += 8;
  const contents = parseStringPointer(buffer, pos);
  pos += 8;
  const sourcemap = parseStringPointer(buffer, pos);
  pos += 8;
  const bytecode = parseStringPointer(buffer, pos);
  pos += 8;
  const encoding = buffer.readUInt8(pos);
  pos += 1;
  const loader = buffer.readUInt8(pos);
  pos += 1;
  const moduleFormat = buffer.readUInt8(pos);
  pos += 1;
  const side = buffer.readUInt8(pos);
  
  return { name, contents, sourcemap, bytecode, encoding, loader, moduleFormat, side };
}

/**
 * Check if module name is the claude entrypoint
 */
function isClaudeModule(moduleName) {
  return (
    moduleName.endsWith('/claude') ||
    moduleName === 'claude' ||
    moduleName.endsWith('/claude.exe') ||
    moduleName === 'claude.exe'
  );
}

/**
 * Iterate over modules in Bun data
 */
function mapModules(bunData, bunOffsets, visitor) {
  const modulesListBytes = getStringPointerContent(bunData, bunOffsets.modulesPtr);
  const modulesListCount = Math.floor(modulesListBytes.length / SIZEOF_MODULE);
  
  for (let i = 0; i < modulesListCount; i++) {
    const offset = i * SIZEOF_MODULE;
    const module = parseCompiledModule(modulesListBytes, offset);
    const moduleName = getStringPointerContent(bunData, module.name).toString('utf-8');
    
    const result = visitor(module, moduleName, i);
    if (result !== undefined) {
      return result;
    }
  }
  
  return undefined;
}

/**
 * Parse Bun data blob that contains: [data][offsets][trailer]
 */
function parseBunDataBlob(bunDataContent) {
  if (bunDataContent.length < SIZEOF_OFFSETS + BUN_TRAILER.length) {
    throw new Error('BUN data is too small');
  }
  
  // Verify trailer
  const trailerStart = bunDataContent.length - BUN_TRAILER.length;
  const trailerBytes = bunDataContent.subarray(trailerStart);
  
  if (!trailerBytes.equals(BUN_TRAILER)) {
    throw new Error('BUN trailer not found');
  }
  
  // Parse Offsets
  const offsetsStart = bunDataContent.length - SIZEOF_OFFSETS - BUN_TRAILER.length;
  const offsetsBytes = bunDataContent.subarray(offsetsStart, offsetsStart + SIZEOF_OFFSETS);
  const bunOffsets = parseOffsets(offsetsBytes);
  
  return { bunOffsets, bunData: bunDataContent };
}

/**
 * Extract Bun data from section (MachO/PE format)
 */
function extractBunDataFromSection(sectionData) {
  if (sectionData.length < 4) {
    throw new Error('Section data too small');
  }
  
  // Try u32 header (old format)
  const bunDataSizeU32 = sectionData.readUInt32LE(0);
  const expectedLengthU32 = 4 + bunDataSizeU32;
  
  // Try u64 header (new format)
  const bunDataSizeU64 = sectionData.length >= 8 ? Number(sectionData.readBigUInt64LE(0)) : 0;
  const expectedLengthU64 = 8 + bunDataSizeU64;
  
  let headerSize, bunDataSize;
  
  // Check which format matches
  if (sectionData.length >= 8 && expectedLengthU64 <= sectionData.length && expectedLengthU64 >= sectionData.length - 4096) {
    headerSize = 8;
    bunDataSize = bunDataSizeU64;
  } else if (expectedLengthU32 <= sectionData.length && expectedLengthU32 >= sectionData.length - 4096) {
    headerSize = 4;
    bunDataSize = bunDataSizeU32;
  } else {
    throw new Error('Cannot determine section header format');
  }
  
  const bunDataContent = sectionData.subarray(headerSize, headerSize + bunDataSize);
  const { bunOffsets, bunData } = parseBunDataBlob(bunDataContent);
  
  return { bunOffsets, bunData, sectionHeaderSize: headerSize };
}

/**
 * Extract Bun data from ELF overlay
 */
function extractBunDataFromELFOverlay(elfBinary) {
  if (!elfBinary.hasOverlay) {
    throw new Error('ELF binary has no overlay data');
  }
  
  const overlayData = elfBinary.overlay;
  
  if (overlayData.length < BUN_TRAILER.length + 8 + SIZEOF_OFFSETS) {
    throw new Error('ELF overlay data is too small');
  }
  
  // Read totalByteCount from last 8 bytes
  const totalByteCount = overlayData.readBigUInt64LE(overlayData.length - 8);
  
  // Verify trailer
  const trailerStart = overlayData.length - 8 - BUN_TRAILER.length;
  const trailerBytes = overlayData.subarray(trailerStart, overlayData.length - 8);
  
  if (!trailerBytes.equals(BUN_TRAILER)) {
    throw new Error('BUN trailer not found in ELF overlay');
  }
  
  // Parse Offsets
  const offsetsStart = overlayData.length - 8 - BUN_TRAILER.length - SIZEOF_OFFSETS;
  const offsetsBytes = overlayData.subarray(offsetsStart, overlayData.length - 8 - BUN_TRAILER.length);
  const bunOffsets = parseOffsets(offsetsBytes);
  
  const byteCount = typeof bunOffsets.byteCount === 'bigint' 
    ? bunOffsets.byteCount 
    : BigInt(bunOffsets.byteCount);
  
  // Extract data region
  const tailDataLen = 8 + BUN_TRAILER.length + SIZEOF_OFFSETS;
  const dataStart = overlayData.length - tailDataLen - Number(byteCount);
  const dataRegion = overlayData.subarray(dataStart, overlayData.length - tailDataLen);
  
  // Reconstruct blob [data][offsets][trailer]
  const bunDataBlob = Buffer.concat([dataRegion, offsetsBytes, trailerBytes]);
  
  return { bunOffsets, bunData: bunDataBlob };
}

/**
 * Extract Bun data from MachO binary
 */
function extractBunDataFromMachO(machoBinary) {
  const bunSegment = machoBinary.getSegment('__BUN');
  if (!bunSegment) throw new Error('__BUN segment not found');
  
  const bunSection = bunSegment.getSection('__bun');
  if (!bunSection) throw new Error('__bun section not found');
  
  return extractBunDataFromSection(bunSection.content);
}

/**
 * Extract Bun data from PE binary
 */
function extractBunDataFromPE(peBinary) {
  const bunSection = peBinary.sections().find(s => s.name === '.bun');
  if (!bunSection) throw new Error('.bun section not found');
  
  return extractBunDataFromSection(bunSection.content);
}

/**
 * Get Bun data from binary (auto-detect format)
 */
function getBunData(binary) {
  switch (binary.format) {
    case 'MachO':
      return extractBunDataFromMachO(binary);
    case 'PE':
      return extractBunDataFromPE(binary);
    case 'ELF':
      return extractBunDataFromELFOverlay(binary);
    default:
      throw new Error(`Unsupported binary format: ${binary.format}`);
  }
}

/**
 * Extract claude.js from native installation binary
 */
function extractClaudeJs(binaryPath) {
  try {
    LIEF.logging.disable();
    const binary = LIEF.parse(binaryPath);
    const { bunOffsets, bunData } = getBunData(binary);
    
    const result = mapModules(bunData, bunOffsets, (module, moduleName) => {
      if (!isClaudeModule(moduleName)) return undefined;
      
      const moduleContents = getStringPointerContent(bunData, module.contents);
      return moduleContents.length > 0 ? moduleContents : undefined;
    });
    
    return result || null;
  } catch (error) {
    return null;
  }
}

/**
 * Rebuild Bun data with modified claude.js
 */
function rebuildBunData(bunData, bunOffsets, modifiedClaudeJs) {
  // Collect all string data and module metadata
  const stringsData = [];
  const modulesMetadata = [];
  
  mapModules(bunData, bunOffsets, (module, moduleName) => {
    const nameBytes = getStringPointerContent(bunData, module.name);
    
    // Use modified contents for claude module
    let contentsBytes;
    if (modifiedClaudeJs && isClaudeModule(moduleName)) {
      contentsBytes = modifiedClaudeJs;
    } else {
      contentsBytes = getStringPointerContent(bunData, module.contents);
    }
    
    const sourcemapBytes = getStringPointerContent(bunData, module.sourcemap);
    const bytecodeBytes = getStringPointerContent(bunData, module.bytecode);
    
    modulesMetadata.push({
      name: nameBytes,
      contents: contentsBytes,
      sourcemap: sourcemapBytes,
      bytecode: bytecodeBytes,
      encoding: module.encoding,
      loader: module.loader,
      moduleFormat: module.moduleFormat,
      side: module.side,
    });
    
    stringsData.push(nameBytes, contentsBytes, sourcemapBytes, bytecodeBytes);
    return undefined;
  });
  
  // Calculate buffer layout
  let currentOffset = 0;
  const stringOffsets = [];
  
  for (const stringData of stringsData) {
    stringOffsets.push({ offset: currentOffset, length: stringData.length });
    currentOffset += stringData.length + 1; // +1 for null terminator
  }
  
  const modulesListOffset = currentOffset;
  const modulesListSize = modulesMetadata.length * SIZEOF_MODULE;
  currentOffset += modulesListSize;
  
  const compileExecArgvBytes = getStringPointerContent(bunData, bunOffsets.compileExecArgvPtr);
  const compileExecArgvOffset = currentOffset;
  const compileExecArgvLength = compileExecArgvBytes.length;
  currentOffset += compileExecArgvLength + 1;
  
  const offsetsOffset = currentOffset;
  currentOffset += SIZEOF_OFFSETS;
  
  const trailerOffset = currentOffset;
  currentOffset += BUN_TRAILER.length;
  
  // Build new buffer
  const newBuffer = Buffer.allocUnsafe(currentOffset);
  newBuffer.fill(0);
  
  // Write strings
  let stringIdx = 0;
  for (const { offset, length } of stringOffsets) {
    if (length > 0) {
      stringsData[stringIdx].copy(newBuffer, offset, 0, length);
    }
    newBuffer[offset + length] = 0;
    stringIdx++;
  }
  
  // Write compileExecArgv
  if (compileExecArgvLength > 0) {
    compileExecArgvBytes.copy(newBuffer, compileExecArgvOffset, 0, compileExecArgvLength);
    newBuffer[compileExecArgvOffset + compileExecArgvLength] = 0;
  }
  
  // Write module structures
  for (let i = 0; i < modulesMetadata.length; i++) {
    const baseStringIdx = i * 4;
    const moduleOffset = modulesListOffset + i * SIZEOF_MODULE;
    let pos = moduleOffset;
    
    // Write StringPointers
    newBuffer.writeUInt32LE(stringOffsets[baseStringIdx].offset, pos);
    newBuffer.writeUInt32LE(stringOffsets[baseStringIdx].length, pos + 4);
    pos += 8;
    newBuffer.writeUInt32LE(stringOffsets[baseStringIdx + 1].offset, pos);
    newBuffer.writeUInt32LE(stringOffsets[baseStringIdx + 1].length, pos + 4);
    pos += 8;
    newBuffer.writeUInt32LE(stringOffsets[baseStringIdx + 2].offset, pos);
    newBuffer.writeUInt32LE(stringOffsets[baseStringIdx + 2].length, pos + 4);
    pos += 8;
    newBuffer.writeUInt32LE(stringOffsets[baseStringIdx + 3].offset, pos);
    newBuffer.writeUInt32LE(stringOffsets[baseStringIdx + 3].length, pos + 4);
    pos += 8;
    
    // Write flags
    newBuffer.writeUInt8(modulesMetadata[i].encoding, pos);
    newBuffer.writeUInt8(modulesMetadata[i].loader, pos + 1);
    newBuffer.writeUInt8(modulesMetadata[i].moduleFormat, pos + 2);
    newBuffer.writeUInt8(modulesMetadata[i].side, pos + 3);
  }
  
  // Write Offsets structure
  let offsetsPos = offsetsOffset;
  newBuffer.writeBigUInt64LE(BigInt(offsetsOffset), offsetsPos);
  offsetsPos += 8;
  newBuffer.writeUInt32LE(modulesListOffset, offsetsPos);
  newBuffer.writeUInt32LE(modulesListSize, offsetsPos + 4);
  offsetsPos += 8;
  newBuffer.writeUInt32LE(bunOffsets.entryPointId, offsetsPos);
  offsetsPos += 4;
  newBuffer.writeUInt32LE(compileExecArgvOffset, offsetsPos);
  newBuffer.writeUInt32LE(compileExecArgvLength, offsetsPos + 4);
  
  // Write trailer
  BUN_TRAILER.copy(newBuffer, trailerOffset);
  
  return newBuffer;
}

/**
 * Build section data with size header
 */
function buildSectionData(bunBuffer, headerSize = 8) {
  const sectionData = Buffer.allocUnsafe(headerSize + bunBuffer.length);
  if (headerSize === 8) {
    sectionData.writeBigUInt64LE(BigInt(bunBuffer.length), 0);
  } else {
    sectionData.writeUInt32LE(bunBuffer.length, 0);
  }
  bunBuffer.copy(sectionData, headerSize);
  return sectionData;
}

/**
 * Repack ELF binary with modified Bun data
 */
function repackELF(elfBinary, binaryPath, newBunBuffer, outputPath) {
  const fs = require('fs');
  
  // Build new overlay
  const newOverlay = Buffer.allocUnsafe(newBunBuffer.length + 8);
  newBunBuffer.copy(newOverlay, 0);
  newOverlay.writeBigUInt64LE(BigInt(newBunBuffer.length), newBunBuffer.length);
  
  elfBinary.overlay = newOverlay;
  
  // Write atomically
  const tempPath = outputPath + '.tmp';
  elfBinary.write(tempPath);
  
  const origStat = fs.statSync(binaryPath);
  fs.chmodSync(tempPath, origStat.mode);
  fs.renameSync(tempPath, outputPath);
}

/**
 * Repack MachO binary with modified Bun data
 */
function repackMachO(machoBinary, binaryPath, newBunBuffer, outputPath, sectionHeaderSize) {
  const fs = require('fs');
  const { execSync } = require('child_process');
  
  // Remove code signature
  if (machoBinary.hasCodeSignature) {
    machoBinary.removeSignature();
  }
  
  const bunSegment = machoBinary.getSegment('__BUN');
  const bunSection = bunSegment.getSection('__bun');
  
  const newSectionData = buildSectionData(newBunBuffer, sectionHeaderSize);
  const sizeDiff = newSectionData.length - Number(bunSection.size);
  
  if (sizeDiff > 0) {
    const isARM64 = machoBinary.header.cpuType === LIEF.MachO.Header.CPU_TYPE.ARM64;
    const PAGE_SIZE = isARM64 ? 16384 : 4096;
    const alignedSizeDiff = Math.ceil(sizeDiff / PAGE_SIZE) * PAGE_SIZE;
    
    machoBinary.extendSegment(bunSegment, alignedSizeDiff);
  }
  
  bunSection.content = newSectionData;
  bunSection.size = BigInt(newSectionData.length);
  
  // Write atomically
  const tempPath = outputPath + '.tmp';
  machoBinary.write(tempPath);
  
  const origStat = fs.statSync(binaryPath);
  fs.chmodSync(tempPath, origStat.mode);
  fs.renameSync(tempPath, outputPath);
  
  // Re-sign with ad-hoc signature
  try {
    execSync(`codesign -s - -f "${outputPath}"`, { stdio: 'ignore' });
  } catch (e) {
    // Ignore codesign errors on non-macOS
  }
}

/**
 * Repack PE binary with modified Bun data
 */
function repackPE(peBinary, binaryPath, newBunBuffer, outputPath, sectionHeaderSize) {
  const fs = require('fs');
  
  const bunSection = peBinary.sections().find(s => s.name === '.bun');
  const newSectionData = buildSectionData(newBunBuffer, sectionHeaderSize);
  
  bunSection.content = newSectionData;
  bunSection.virtualSize = BigInt(newSectionData.length);
  bunSection.size = BigInt(newSectionData.length);
  
  // Write atomically
  const tempPath = outputPath + '.tmp';
  peBinary.write(tempPath);
  fs.renameSync(tempPath, outputPath);
}

/**
 * Repack native installation with modified claude.js
 */
function repackNativeInstallation(binaryPath, modifiedClaudeJs, outputPath) {
  LIEF.logging.disable();
  const binary = LIEF.parse(binaryPath);
  
  const { bunOffsets, bunData, sectionHeaderSize } = getBunData(binary);
  const newBuffer = rebuildBunData(bunData, bunOffsets, modifiedClaudeJs);
  
  switch (binary.format) {
    case 'MachO':
      repackMachO(binary, binaryPath, newBuffer, outputPath, sectionHeaderSize);
      break;
    case 'PE':
      repackPE(binary, binaryPath, newBuffer, outputPath, sectionHeaderSize);
      break;
    case 'ELF':
      repackELF(binary, binaryPath, newBuffer, outputPath);
      break;
    default:
      throw new Error(`Unsupported binary format: ${binary.format}`);
  }
}

module.exports = {
  extractClaudeJs,
  repackNativeInstallation,
  isClaudeModule,
  BUN_TRAILER,
};
