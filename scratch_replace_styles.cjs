const fs = require('fs');
const path = require('path');

const replacements = [
  // Margins
  { from: /style=\{\{\s*margin:\s*0\s*\}\}/g, toClass: 'm-0' },
  { from: /style=\{\{\s*marginTop:\s*4\s*\}\}/g, toClass: 'mt-4' },
  { from: /style=\{\{\s*marginTop:\s*6\s*\}\}/g, toClass: 'mt-6' },
  { from: /style=\{\{\s*marginTop:\s*8\s*\}\}/g, toClass: 'mt-8' },
  { from: /style=\{\{\s*marginTop:\s*12\s*\}\}/g, toClass: 'mt-12' },
  { from: /style=\{\{\s*marginTop:\s*14\s*\}\}/g, toClass: 'mt-14' },
  { from: /style=\{\{\s*marginTop:\s*16\s*\}\}/g, toClass: 'mt-16' },
  { from: /style=\{\{\s*marginBottom:\s*4\s*\}\}/g, toClass: 'mb-4' },
  { from: /style=\{\{\s*marginBottom:\s*8\s*\}\}/g, toClass: 'mb-8' },
  { from: /style=\{\{\s*marginBottom:\s*12\s*\}\}/g, toClass: 'mb-12' },
  { from: /style=\{\{\s*marginBottom:\s*16\s*\}\}/g, toClass: 'mb-16' },
  { from: /style=\{\{\s*marginInlineStart:\s*2\s*\}\}/g, toClass: 'mis-2' },
  { from: /style=\{\{\s*marginInlineStart:\s*8\s*\}\}/g, toClass: 'mis-8' },
  { from: /style=\{\{\s*marginRight:\s*6\s*\}\}/g, toClass: 'mr-6' },
  { from: /style=\{\{\s*marginLeft:\s*6\s*\}\}/g, toClass: 'ml-6' },

  // Typography
  { from: /style=\{\{\s*fontSize:\s*'0\.72rem',\s*fontWeight:\s*400,\s*color:\s*'var\(--color-muted\)'\s*\}\}/g, toClass: 'text-xs text-muted font-normal' },
  { from: /style=\{\{\s*fontSize:\s*'0\.78rem',\s*color:\s*'var\(--color-muted\)'\s*\}\}/g, toClass: 'text-xs text-muted' },
  { from: /style=\{\{\s*fontSize:\s*'0\.85rem',\s*color:\s*'var\(--color-muted\)',\s*marginBottom:\s*12\s*\}\}/g, toClass: 'text-sm text-muted mb-12' },
  { from: /style=\{\{\s*color:\s*'var\(--color-muted\)',\s*fontSize:\s*'0\.78rem',\s*marginRight:\s*6\s*\}\}/g, toClass: 'text-xs text-muted mr-6' },
  { from: /style=\{\{\s*fontWeight:\s*600,\s*fontSize:\s*'0\.85rem'\s*\}\}/g, toClass: 'font-semibold text-sm' },
  { from: /style=\{\{\s*fontWeight:\s*700,\s*fontSize:\s*'1\.1rem'\s*\}\}/g, toClass: 'font-bold text-lg' },
  { from: /style=\{\{\s*fontWeight:\s*700\s*\}\}/g, toClass: 'font-bold' },
  { from: /style=\{\{\s*color:\s*'var\(--color-muted\)'\s*\}\}/g, toClass: 'text-muted' },
  { from: /style=\{\{\s*color:\s*'var\(--color-primary\)'\s*\}\}/g, toClass: 'text-primary' },
  { from: /style=\{\{\s*color:\s*'var\(--color-danger\)'\s*\}\}/g, toClass: 'text-danger' },
  { from: /style=\{\{\s*textAlign:\s*'center'\s*\}\}/g, toClass: 'text-center' },
  { from: /style=\{\{\s*textAlign:\s*'right'\s*\}\}/g, toClass: 'text-right' },
  { from: /style=\{\{\s*textAlign:\s*'left'\s*\}\}/g, toClass: 'text-left' },

  // Layout
  { from: /style=\{\{\s*display:\s*'flex',\s*alignItems:\s*'center',\s*gap:\s*8\s*\}\}/g, toClass: 'flex items-center gap-8' },
  { from: /style=\{\{\s*display:\s*'flex',\s*gap:\s*8\s*\}\}/g, toClass: 'flex gap-8' },
  { from: /style=\{\{\s*display:\s*'flex',\s*gap:\s*16\s*\}\}/g, toClass: 'flex gap-16' },
  { from: /style=\{\{\s*flex:\s*1\s*\}\}/g, toClass: 'flex-1' },
  { from: /style=\{\{\s*display:\s*'grid',\s*gridTemplateColumns:\s*'1fr'\s*\}\}/g, toClass: 'grid grid-cols-1' },
  { from: /style=\{\{\s*gridTemplateColumns:\s*'1fr'\s*\}\}/g, toClass: 'grid-cols-1' },

  // Other combinations
  { from: /style=\{\{\s*margin:\s*0,\s*fontSize:\s*'0\.92rem',\s*lineHeight:\s*1\.6\s*\}\}/g, toClass: 'm-0 text-sm leading-relaxed' },
];

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  for (const { from, toClass } of replacements) {
    if (from.test(content)) {
      content = content.replace(from, () => `DATA_REPLACE_STYLE="${toClass}"`);
      changed = true;
    }
  }

  if (changed) {
    content = content.replace(/className="([^"]+)"\s+DATA_REPLACE_STYLE="([^"]+)"/g, 'className="$1 $2"');
    content = content.replace(/DATA_REPLACE_STYLE="([^"]+)"\s+className="([^"]+)"/g, 'className="$1 $2"');
    content = content.replace(/DATA_REPLACE_STYLE="([^"]+)"/g, 'className="$1"');
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated: ${filePath}`);
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walkDir(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      processFile(fullPath);
    }
  }
}

walkDir(path.join(__dirname, 'src/renderer/src'));
