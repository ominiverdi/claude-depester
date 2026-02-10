/**
 * Bun binary extraction and repacking utilities
 * Based on tweakcc's approach - proper Bun binary structure handling
 *
 * @author Lorenzo Becchi (https://github.com/ominiverdi)
 * @license MIT
 */

const LIEF = require('node-lief');

// Bun trailer that marks the end of embedded data
const BUN_TRAILER = Buffer.from('\n---- Bun! ----\n');

// Size constants for binary structures
const SIZEOF_OFFSETS = 32;
const SIZEOF_STRING_POINTER = 8;
// Module struct sizes vary by Bun version:
// - Old format (pre-ESM bytecode, before Bun ~1.3.7): 4 StringPointers + 4 u8s = 36 bytes
// - New format (ESM bytecode, Bun ~1.3.7+): 6 StringPointers + 4 u8s = 52 bytes
const SIZEOF_MODULE_OLD = 4 * SIZEOF_STRING_POINTER + 4;
const SIZEOF_MODULE_NEW = 6 * SIZEOF_STRING_POINTER + 4;

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
  pos += 8;
  const flags = buffer.readUInt32LE(pos);
  
  return { byteCount, modulesPtr, entryPointId, compileExecArgvPtr, flags };
}

/**
 * Detect the module struct size from the modules list byte length
 */
function detectModuleStructSize(modulesListLength) {
  const fitsNew = modulesListLength % SIZEOF_MODULE_NEW === 0;
  const fitsOld = modulesListLength % SIZEOF_MODULE_OLD === 0;
  
  if (fitsNew && !fitsOld) return SIZEOF_MODULE_NEW;
  if (fitsOld && !fitsNew) return SIZEOF_MODULE_OLD;
  // Ambiguous or neither - prefer new format for recent Bun versions
  return SIZEOF_MODULE_NEW;
}

/**
 * Parse a compiled module from buffer
 */
function parseCompiledModule(buffer, offset, moduleStructSize) {
  let pos = offset;
  const name = parseStringPointer(buffer, pos);
  pos += 8;
  const contents = parseStringPointer(buffer, pos);
  pos += 8;
  const sourcemap = parseStringPointer(buffer, pos);
  pos += 8;
  const bytecode = parseStringPointer(buffer, pos);
  pos += 8;
  
  let moduleInfo, bytecodeOriginPath;
  if (moduleStructSize === SIZEOF_MODULE_NEW) {
    moduleInfo = parseStringPointer(buffer, pos);
    pos += 8;
    bytecodeOriginPath = parseStringPointer(buffer, pos);
    pos += 8;
  } else {
    moduleInfo = { offset: 0, length: 0 };
    bytecodeOriginPath = { offset: 0, length: 0 };
  }
  
  const encoding = buffer.readUInt8(pos);
  pos += 1;
  const loader = buffer.readUInt8(pos);
  pos += 1;
  const moduleFormat = buffer.readUInt8(pos);
  pos += 1;
  const side = buffer.readUInt8(pos);
  
  return { name, contents, sourcemap, bytecode, moduleInfo, bytecodeOriginPath, encoding, loader, moduleFormat, side };
}

/**
 * Check if module name is the claude entrypoint
 * Claude Code 2.0.69+ changed from '/claude' to 'file:///src/entrypoints/cli.js.jsc'
 */
function isClaudeModule(moduleName) {
  return (
    moduleName.endsWith('/claude') ||
    moduleName === 'claude' ||
    moduleName.endsWith('/claude.exe') ||
    moduleName === 'claude.exe' ||
    moduleName.includes('/cli.js') ||
    moduleName.endsWith('cli.js.jsc')
  );
}

/**
 * Iterate over modules in Bun data
 */
function mapModules(bunData, bunOffsets, moduleStructSize, visitor) {
  const modulesListBytes = getStringPointerContent(bunData, bunOffsets.modulesPtr);
  const modulesListCount = Math.floor(modulesListBytes.length / moduleStructSize);
  
  for (let i = 0; i < modulesListCount; i++) {
    const offset = i * moduleStructSize;
    const module = parseCompiledModule(modulesListBytes, offset, moduleStructSize);
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
  const moduleStructSize = detectModuleStructSize(bunOffsets.modulesPtr.length);
  
  return { bunOffsets, bunData: bunDataContent, moduleStructSize };
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
  const { bunOffsets, bunData, moduleStructSize } = parseBunDataBlob(bunDataContent);
  
  return { bunOffsets, bunData, sectionHeaderSize: headerSize, moduleStructSize };
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
  const moduleStructSize = detectModuleStructSize(bunOffsets.modulesPtr.length);
  
  return { bunOffsets, bunData: bunDataBlob, moduleStructSize };
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
    const { bunOffsets, bunData, moduleStructSize } = getBunData(binary);
    
    let target = null;
    let claudeFallback = null;
    
    mapModules(bunData, bunOffsets, moduleStructSize, (module, moduleName) => {
      // Check contents for marker words
      const moduleContents = getStringPointerContent(bunData, module.contents);
      if (moduleContents.includes('Flibbertigibbeting')) {
        target = { content: moduleContents, moduleName, type: 'contents' };
        return true;
      }
      
      // Remember claude module contents as fallback (for post-patch status checks)
      // Contents is where the runtime reads from, so always prefer it
      if (isClaudeModule(moduleName) && moduleContents.length > 0) {
        claudeFallback = { content: moduleContents, moduleName, type: 'contents' };
      }
      
      // Check bytecode (for versions where source is only in bytecode)
      const moduleBytecode = getStringPointerContent(bunData, module.bytecode);
      if (moduleBytecode.includes('Flibbertigibbeting')) {
        // Only use bytecode if contents doesn't have meaningful JS
        if (!claudeFallback || claudeFallback.content.length === 0) {
          target = { content: moduleBytecode, moduleName, type: 'bytecode' };
          return true;
        }
      }
      
      return undefined;
    });
    
    // Prefer: exact marker match > claude module contents > bytecode marker match
    return target || claudeFallback;
  } catch (error) {
    return null;
  }
}

/**
 * Rebuild Bun data with modified claude.js
 */
function rebuildBunData(bunData, bunOffsets, modifiedClaudeJs, targetModuleName, targetType, moduleStructSize) {
  // Collect all string data and module metadata
  const stringsData = [];
  const modulesMetadata = [];
  const stringsPerModule = moduleStructSize === SIZEOF_MODULE_NEW ? 6 : 4;
  
  mapModules(bunData, bunOffsets, moduleStructSize, (module, moduleName) => {
    const nameBytes = getStringPointerContent(bunData, module.name);
    
    let contentsBytes = getStringPointerContent(bunData, module.contents);
    let bytecodeBytes = getStringPointerContent(bunData, module.bytecode);
    
    if (modifiedClaudeJs && moduleName === targetModuleName) {
      if (targetType === 'bytecode') {
        bytecodeBytes = modifiedClaudeJs;
      } else {
        contentsBytes = modifiedClaudeJs;
      }
    }
    
    const sourcemapBytes = getStringPointerContent(bunData, module.sourcemap);
    const moduleInfoBytes = getStringPointerContent(bunData, module.moduleInfo);
    const bytecodeOriginPathBytes = getStringPointerContent(bunData, module.bytecodeOriginPath);
    
    modulesMetadata.push({
      name: nameBytes,
      contents: contentsBytes,
      sourcemap: sourcemapBytes,
      bytecode: bytecodeBytes,
      moduleInfo: moduleInfoBytes,
      bytecodeOriginPath: bytecodeOriginPathBytes,
      encoding: module.encoding,
      loader: module.loader,
      moduleFormat: module.moduleFormat,
      side: module.side,
    });
    
    if (moduleStructSize === SIZEOF_MODULE_NEW) {
      stringsData.push(nameBytes, contentsBytes, sourcemapBytes, bytecodeBytes, moduleInfoBytes, bytecodeOriginPathBytes);
    } else {
      stringsData.push(nameBytes, contentsBytes, sourcemapBytes, bytecodeBytes);
    }
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
  const modulesListSize = modulesMetadata.length * moduleStructSize;
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
    const baseStringIdx = i * stringsPerModule;
    const moduleOffset = modulesListOffset + i * moduleStructSize;
    let pos = moduleOffset;
    
    // Write StringPointers (4 common to both formats)
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
    
    // Write new-format-only StringPointers (moduleInfo, bytecodeOriginPath)
    if (moduleStructSize === SIZEOF_MODULE_NEW) {
      newBuffer.writeUInt32LE(stringOffsets[baseStringIdx + 4].offset, pos);
      newBuffer.writeUInt32LE(stringOffsets[baseStringIdx + 4].length, pos + 4);
      pos += 8;
      newBuffer.writeUInt32LE(stringOffsets[baseStringIdx + 5].offset, pos);
      newBuffer.writeUInt32LE(stringOffsets[baseStringIdx + 5].length, pos + 4);
      pos += 8;
    }
    
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
  offsetsPos += 8;
  newBuffer.writeUInt32LE(bunOffsets.flags || 0, offsetsPos);
  
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
 * Repack MachO binary with modified Bun data using raw file write.
 * Bypasses LIEF write() which has a bug that bloats MachO binaries.
 * Instead, writes the patched section data directly at the file offset.
 */
function repackMachO(machoBinary, binaryPath, newBunBuffer, outputPath, sectionHeaderSize) {
  const fs = require('fs');
  const { execSync } = require('child_process');
  
  const bunSegment = machoBinary.getSegment('__BUN');
  const bunSection = bunSegment.getSection('__bun');
  
  const originalSectionSize = Number(bunSection.size);
  const sectionFileOffset = Number(bunSection.offset);
  
  const newSectionData = buildSectionData(newBunBuffer, sectionHeaderSize);
  
  if (newSectionData.length > originalSectionSize) {
    throw new Error(
      `Patched section data (${newSectionData.length}) is larger than original (${originalSectionSize}). ` +
      'This should not happen since we only replace arrays with shorter content.'
    );
  }
  
  // Pad new section data to original size so binary layout stays identical
  const paddedSectionData = Buffer.alloc(originalSectionSize, 0);
  newSectionData.copy(paddedSectionData, 0);
  // Update the size header to reflect actual data size (not padded)
  if (sectionHeaderSize === 8) {
    paddedSectionData.writeBigUInt64LE(BigInt(newBunBuffer.length), 0);
  } else {
    paddedSectionData.writeUInt32LE(newBunBuffer.length, 0);
  }
  
  // Raw file write: copy original binary, overwrite section bytes
  const tempPath = outputPath + '.tmp';
  fs.copyFileSync(binaryPath, tempPath);
  
  const fd = fs.openSync(tempPath, 'r+');
  try {
    fs.writeSync(fd, paddedSectionData, 0, paddedSectionData.length, sectionFileOffset);
  } finally {
    fs.closeSync(fd);
  }
  
  const origStat = fs.statSync(binaryPath);
  fs.chmodSync(tempPath, origStat.mode);
  fs.renameSync(tempPath, outputPath);
  
  // Re-sign with ad-hoc signature (needed on macOS after modifying binary)
  try {
    execSync(`codesign -s - -f "${outputPath}"`, { stdio: 'ignore' });
  } catch (e) {
    // Ignore codesign errors on non-macOS
  }
}

/**
 * Repack PE binary with modified Bun data using raw file write.
 * Bypasses LIEF write() to avoid potential binary corruption.
 */
function repackPE(peBinary, binaryPath, newBunBuffer, outputPath, sectionHeaderSize) {
  const fs = require('fs');
  
  const bunSection = peBinary.sections().find(s => s.name === '.bun');
  
  const originalSectionSize = Number(bunSection.size);
  // PE section file offset property name varies by node-lief version
  const sectionFileOffset = Number(bunSection.pointerToRawData || bunSection.pointersToRawData || bunSection.offset);
  
  const newSectionData = buildSectionData(newBunBuffer, sectionHeaderSize);
  
  if (newSectionData.length > originalSectionSize) {
    throw new Error(
      `Patched section data (${newSectionData.length}) is larger than original (${originalSectionSize}). ` +
      'This should not happen since we only replace arrays with shorter content.'
    );
  }
  
  // Pad new section data to original size so binary layout stays identical
  const paddedSectionData = Buffer.alloc(originalSectionSize, 0);
  newSectionData.copy(paddedSectionData, 0);
  if (sectionHeaderSize === 8) {
    paddedSectionData.writeBigUInt64LE(BigInt(newBunBuffer.length), 0);
  } else {
    paddedSectionData.writeUInt32LE(newBunBuffer.length, 0);
  }
  
  // Raw file write: copy original binary, overwrite section bytes
  const tempPath = outputPath + '.tmp';
  fs.copyFileSync(binaryPath, tempPath);
  
  const fd = fs.openSync(tempPath, 'r+');
  try {
    fs.writeSync(fd, paddedSectionData, 0, paddedSectionData.length, sectionFileOffset);
  } finally {
    fs.closeSync(fd);
  }
  
  fs.renameSync(tempPath, outputPath);
}

/**
 * Repack native installation with modified claude.js
 */
function repackNativeInstallation(binaryPath, modifiedClaudeJs, outputPath, targetModuleName, targetType) {
  LIEF.logging.disable();
  const binary = LIEF.parse(binaryPath);
  
  const { bunOffsets, bunData, sectionHeaderSize, moduleStructSize } = getBunData(binary);
  const newBuffer = rebuildBunData(bunData, bunOffsets, modifiedClaudeJs, targetModuleName, targetType, moduleStructSize);
  
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
