const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

async function buildIcons() {
  const iconSvgPath = path.join(__dirname, '../src/assets/icon.svg');
  const iconsetDir = path.join(__dirname, '../build/icon.iconset');
  const icnsOutputPath = path.join(__dirname, '../src/assets/icon.icns');

  console.log('🎨 Building app icons...');

  // Create iconset directory
  if (!fs.existsSync(iconsetDir)) {
    fs.mkdirSync(iconsetDir, { recursive: true });
  }

  // Mac icon sizes needed
  const sizes = [
    { size: 16, name: 'icon_16x16.png' },
    { size: 32, name: 'icon_16x16@2x.png' },
    { size: 32, name: 'icon_32x32.png' },
    { size: 64, name: 'icon_32x32@2x.png' },
    { size: 128, name: 'icon_128x128.png' },
    { size: 256, name: 'icon_128x128@2x.png' },
    { size: 256, name: 'icon_256x256.png' },
    { size: 512, name: 'icon_256x256@2x.png' },
    { size: 512, name: 'icon_512x512.png' },
    { size: 1024, name: 'icon_512x512@2x.png' },
  ];

  // Generate PNGs at different sizes
  console.log('📐 Generating PNG files at various sizes...');
  for (const { size, name } of sizes) {
    const outputPath = path.join(iconsetDir, name);
    await sharp(iconSvgPath)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`  ✓ Created ${name}`);
  }

  // Convert iconset to .icns using iconutil
  console.log('🔧 Converting to .icns format...');

  try {
    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsOutputPath], {
      stdio: 'inherit'
    });
    console.log(`✅ Icon created: ${icnsOutputPath}`);
  } catch (error) {
    console.error('❌ Error creating .icns file:', error);
    throw error;
  }

  // Clean up iconset directory
  fs.rmSync(iconsetDir, { recursive: true, force: true });

  console.log('✨ Icon generation complete!');
}

buildIcons().catch(console.error);
