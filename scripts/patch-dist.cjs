const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
if (fs.existsSync(indexPath)) {
  let content = fs.readFileSync(indexPath, 'utf8');
  // Reemplazar rutas absolutas /assets/ por ./assets/ para que funcione en Electron bajo protocolo file://
  content = content.replace(/src=["']\/assets\//g, 'src="./assets/');
  content = content.replace(/href=["']\/assets\//g, 'href="./assets/');
  content = content.replace(/href=["']\/manifest\.webmanifest["']/g, 'href="./manifest.webmanifest"');
  content = content.replace(/src=["']\/true\/assets\//g, 'src="./assets/');
  content = content.replace(/href=["']\/true\/assets\//g, 'href="./assets/');
  fs.writeFileSync(indexPath, content, 'utf8');
  console.log('[patch-dist] Rutas relativas aplicadas con éxito a dist/index.html');
}
