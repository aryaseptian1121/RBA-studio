// ============================================================
// RBA STUDIO PRO — generate-icon.js
// Creates a default icon if none exists
// ============================================================

const fs   = require('fs');
const path = require('path');

// Simple 16x16 ICO file header + bitmap
// This creates a minimal valid .ico file with a blue square

const assetsDir = path.join(__dirname, 'assets');
const iconPath  = path.join(assetsDir, 'icon.ico');

if (fs.existsSync(iconPath)) {
  console.log('✅ Icon already exists:', iconPath);
  process.exit(0);
}

// Create a minimal ICO file (16x16, 32-bit color)
// ICO header: 6 bytes
// ICONDIRENTRY: 16 bytes
// BMP data: 16*16*4 + 40 (header) = 1064 bytes

const width = 16;
const height = 16;

// ICO Header
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);     // Reserved
icoHeader.writeUInt16LE(1, 2);     // Type: 1 = ICO
icoHeader.writeUInt16LE(1, 4);     // Number of images

// ICONDIRENTRY
const dirEntry = Buffer.alloc(16);
dirEntry.writeUInt8(width, 0);     // Width
dirEntry.writeUInt8(height, 1);    // Height
dirEntry.writeUInt8(0, 2);         // Color palette
dirEntry.writeUInt8(0, 3);         // Reserved
dirEntry.writeUInt16LE(1, 4);      // Color planes
dirEntry.writeUInt16LE(32, 6);     // Bits per pixel
const bmpSize = 40 + (width * height * 4) + (width * height / 8);
dirEntry.writeUInt32LE(bmpSize, 8);  // Size of BMP data
dirEntry.writeUInt32LE(22, 12);    // Offset to BMP data

// BITMAPINFOHEADER
const bmpHeader = Buffer.alloc(40);
bmpHeader.writeUInt32LE(40, 0);    // Header size
bmpHeader.writeInt32LE(width, 4);  // Width
bmpHeader.writeInt32LE(height * 2, 8);  // Height (doubled for XOR+AND)
bmpHeader.writeUInt16LE(1, 12);    // Planes
bmpHeader.writeUInt16LE(32, 14);   // Bits per pixel
bmpHeader.writeUInt32LE(0, 16);     // Compression
bmpHeader.writeUInt32LE(width * height * 4, 20);  // Image size

// Pixel data (16x16 BGRA) - Blue gradient icon
const pixels = Buffer.alloc(width * height * 4);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    // Create a gradient blue icon
    pixels[idx] = 246;      // B
    pixels[idx + 1] = 130;  // G  
    pixels[idx + 2] = 59;   // R (#3b82f6)
    pixels[idx + 3] = 255; // A
  }
}

// AND mask (16x16 = 32 bytes, all 0 = opaque)
const andMask = Buffer.alloc(width * height / 8);

// Combine all parts
const ico = Buffer.concat([icoHeader, dirEntry, bmpHeader, pixels, andMask]);

// Write file
fs.writeFileSync(iconPath, ico);

console.log('✅ Icon created:', iconPath);
console.log('   Size:', ico.length, 'bytes');