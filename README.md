# LabStock

Inventario de laboratorio: productos con código QR único, escaneo, control de stock, lista de compra y modo programador.

## Estructura

```
labstock/
├── index.html   # Estructura de pantallas y barra inferior
├── styles.css   # Estilos
├── app.js       # Lógica (estado, QR, escáner, eventos)
└── README.md
```

## Cómo abrirlo en VS Code

1. Abre la carpeta `labstock` en VS Code (`Archivo > Abrir carpeta`).
2. Instala la extensión **Live Server** (de Ritwik Gupta).
3. Haz clic derecho en `index.html` y elige **Open with Live Server**.

Alternativa sin extensiones, desde la terminal dentro de la carpeta:

```bash
python3 -m http.server 5500
```

Luego abre `http://localhost:5500`.

> La cámara del escáner solo funciona en `localhost` o en `https`. Si la abres desde el móvil en tu red local, necesitarás un servidor https.

## Configuración

- **Código de programador**: en `app.js`, cambia `PROGRAMMER_CODE` (por defecto `1234`).
- **Categorías**: edita el array `CATEGORIES` en `app.js`.
- **Datos**: se guardan en `localStorage` del navegador. Para borrarlos todos, ejecuta `localStorage.clear()` en la consola del navegador.

## Funciones

- Panel con total de productos, unidades y agotados.
- Alta de productos con nombre, categoría, stock actual y stock mínimo. Cada producto recibe un código `LBK-XXXXXX` y su QR.
- Escáner QR (o búsqueda manual del código) para abrir la ficha.
- Ficha con botones para sumar o restar una unidad, QR e historial de movimientos.
- Inventario con búsqueda y filtros por categoría.
- Lista de compra con los productos agotados o bajo mínimo.
- Modo programador: solo con el código activo se pueden editar o eliminar productos.
