// ============================================================
// RBA STUDIO PRO — obfuscate.js
// Obfuscates source code for production build
// ============================================================

const JavaScriptObfuscator = require('javascript-obfuscator');
const fs   = require('fs');
const path = require('path');

const FILES_TO_OBFUSCATE = [
  'auth.js'
  // Skip app.js - contains complex regex that breaks javascript-obfuscator
];

const OUTPUT_DIR = 'dist-obfuscated';

// Create output directory
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

// Copy all files first
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  fs.readdirSync(src).forEach(file => {
    const srcPath  = path.join(src, file);
    const destPath = path.join(dest, file);
    
    if (fs.statSync(srcPath).isDirectory()) {
      // Skip certain directories
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== OUTPUT_DIR) {
        copyDir(srcPath, destPath);
      }
    } else {
      // Copy file
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (e) {
        // Ignore copy errors for some files
      }
    }
  });
}

console.log('📁 Copying project files...');
copyDir('.', OUTPUT_DIR);

// Obfuscate specific files
console.log('🔒 Obfuscating source files...');

FILES_TO_OBFUSCATE.forEach(file => {
  const srcPath = path.join(OUTPUT_DIR, file);
  
  if (!fs.existsSync(srcPath)) {
    console.log('⚠️  File not found, skipping:', file);
    return;
  }

  const code = fs.readFileSync(srcPath, 'utf8');

  const obfuscated = JavaScriptObfuscator.obfuscate(code, {
    compact:               true,
    debugProtection:       false,
    disableConsoleOutput:  true,
    identifierNamesGenerator: 'hexadecimal',
    log:                   false,
    renameGlobals:         false,
    rotateStringArray:     true,
    shuffleStringArray:    true,
    stringArray:           true,
    stringArrayEncoding:  ['base64'],
    stringArrayThreshold:  0.3,
    transformObjectKeys:   false,
    unicodeEscapeSequence: false
  });

  fs.writeFileSync(srcPath, obfuscated.getObfuscatedCode(), 'utf8');
  console.log('✅ Obfuscated:', file);
});

console.log('');
console.log('🎉 Obfuscation complete!');
console.log('📂 Output folder:', OUTPUT_DIR);
console.log('');
console.log('To build:');
console.log('  cd ' + OUTPUT_DIR);
console.log('  npx electron-builder --win --x64');