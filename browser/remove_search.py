import re
import os

docs = ['docs.html', 'installation.html', 'languages.html', 'running-locally.html', 'shortcuts.html', 'license.html', 'prerequisites.html']
search_block = r'\s*<!-- Sidebar Search -->\s*<div class="mb-6">\s*<div class="relative">.*?</div>\s*</div>'

for f in docs:
    path = os.path.join(r'c:\Users\omg\CilamAICode\browser', f)
    with open(path, 'r', encoding='utf-8') as file:
        content = file.read()
    content = re.sub(search_block, '', content, flags=re.DOTALL)
    with open(path, 'w', encoding='utf-8') as file:
        file.write(content)

print("done")
