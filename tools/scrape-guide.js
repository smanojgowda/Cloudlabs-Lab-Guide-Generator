import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  for (let p = 1; p <= 19; p++) {
    await page.goto(
      'https://experience.cloudlabs.ai/#labguidepreview/f377598d-f09d-4813-b1db-367936319db8/' + p,
      { waitUntil: 'networkidle', timeout: 30000 }
    );
    await page.waitForTimeout(4000);

    const text = await page.evaluate(() => {
      const md = document.querySelector('cloudlabs-markdown markdown') ||
                 document.querySelector('#guide-page');
      if (!md) return 'NO CONTENT FOUND';

      let result = '';
      for (const child of md.children) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'h1') result += '# ' + child.textContent.trim() + '\n\n';
        else if (tag === 'h2') result += '## ' + child.textContent.trim() + '\n\n';
        else if (tag === 'h3') result += '### ' + child.textContent.trim() + '\n\n';
        else if (tag === 'h4') result += '#### ' + child.textContent.trim() + '\n\n';
        else if (tag === 'p') {
          let text = '';
          for (const node of child.childNodes) {
            if (node.tagName === 'IMG') {
              text += '![' + (node.alt || '') + '](' + node.src + ')';
            } else if (node.tagName === 'STRONG') {
              text += '**' + node.textContent + '**';
            } else if (node.tagName === 'CODE') {
              text += '`' + node.textContent + '`';
            } else {
              text += node.textContent;
            }
          }
          result += text.trim() + '\n\n';
        }
        else if (tag === 'ul') {
          for (const li of child.children) {
            result += '- ' + li.textContent.trim() + '\n';
          }
          result += '\n';
        }
        else if (tag === 'ol') {
          let i = 1;
          for (const li of child.children) {
            let text = '';
            for (const node of li.childNodes) {
              if (node.tagName === 'IMG') {
                text += '\n\n   ![' + (node.alt || '') + '](' + node.src + ')\n\n';
              } else if (node.tagName === 'STRONG') {
                text += '**' + node.textContent + '**';
              } else if (node.tagName === 'CODE') {
                text += '`' + node.textContent + '`';
              } else if (node.tagName === 'P') {
                text += node.textContent;
              } else {
                text += node.textContent;
              }
            }
            result += i + '. ' + text.trim() + '\n\n';
            i++;
          }
        }
        else if (tag === 'blockquote') {
          result += '> ' + child.textContent.trim() + '\n\n';
        }
        else if (tag === 'pre') {
          result += '```\n' + child.textContent.trim() + '\n```\n\n';
        }
        else if (tag === 'table') {
          // Extract table
          const rows = child.querySelectorAll('tr');
          for (const row of rows) {
            const cells = row.querySelectorAll('th, td');
            result += '| ';
            for (const cell of cells) {
              result += cell.textContent.trim() + ' | ';
            }
            result += '\n';
          }
          result += '\n';
        }
        else if (tag === 'div' && child.className.includes('alert')) {
          result += '> **Note:** ' + child.textContent.trim() + '\n\n';
        }
        else {
          const txt = child.textContent.trim();
          if (txt) result += txt + '\n\n';
        }
      }
      return result;
    });

    console.log('========== PAGE ' + p + ' ==========');
    console.log(text);
    console.log('');
  }
  await browser.close();
})();
