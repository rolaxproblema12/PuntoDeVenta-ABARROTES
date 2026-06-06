# Importar mercancía desde "Abarrotes Punto de Venta" (pdvdata.fdb)

El POS viejo guarda su catálogo en una base de datos **Firebird 1.5** (`pdvdata.fdb`,
ODS 10, página de 16 KB). Nuestra producción es **serverless** (Vercel + Supabase) y
no puede abrir un `.fdb` (necesita el motor nativo de Firebird), así que la migración
es en **dos pasos**:

```
pdvdata.fdb ──[conversor local]──► productos.csv / productos.json ──[web: Importar]──► catálogo
```

1. **Conversor local** (`extract.mjs`): corre en la PC del dueño, lee el `.fdb` con el
   motor Firebird 1.5 embebido y exporta un CSV/JSON portátil.
2. **Importador web**: en _Catálogo de productos → Importar_ se sube ese CSV/JSON y se
   da de alta la mercancía vía la RPC atómica `upsert_product`.

---

## 1. Armar el kit de Firebird 1.5 (una sola vez)

Solo un motor de la rama **1.5** abre ODS 10 (los 2.5/3/4 **no**). El paquete embebido
trae el motor pero no `isql.exe`; el paquete completo trae las herramientas pero el
cliente habla con un servidor. Se combinan: `isql.exe` + `fbembed.dll` (renombrado a
`fbclient.dll`) = motor **embebido sin servidor**.

Descargas oficiales (Firebird en SourceForge, release 1.5.6):

- `Firebird-1.5.6.5026-0_embed_win32.zip` → de aquí: `fbembed.dll`, `firebird.conf`, `intl/`
- `Firebird-1.5.6.5026-0_win32.zip` → de aquí: `bin/isql.exe`, `bin/ib_util.dll`, `firebird.msg`

Estructura final del kit (por defecto `%USERPROFILE%\.fbtools\kit`):

```
kit\
  isql.exe          (del paquete completo)
  ib_util.dll       (del paquete completo)
  firebird.msg      (del paquete completo)
  firebird.conf     (del paquete embebido)
  fbclient.dll      ← copia de fbembed.dll renombrada
  intl\             (del paquete embebido, opcional para acentos)
```

> En esta máquina el kit ya está armado en `C:\Users\r\.fbtools\kit`.

---

## 2. Correr el conversor

```powershell
# desde la raíz del repo
node tools/fdb-import/extract.mjs --db "D:\pdvdata.fdb"
```

Opciones:

| Flag    | Default                          | Descripción                          |
| ------- | -------------------------------- | ------------------------------------ |
| `--db`  | `D:\pdvdata.fdb`                 | Ruta al archivo Firebird.            |
| `--kit` | `%USERPROFILE%\.fbtools\kit`     | Carpeta del kit Firebird.            |
| `--out` | `tools/fdb-import/output`        | Carpeta de salida.                   |

Genera en `--out`:

- **`productos.csv`** — `codigo, descripcion, tipo_venta, costo, precio, mayoreo, existencia, departamento`
  (UTF-8 con BOM para que Excel respete los acentos). `existencia` va vacía cuando el
  producto no lleva control de inventario en el POS viejo (`DINVENTARIO = -1`).
- **`productos.json`** — mismo contenido + metadatos (`count`, `departamentos`, etc.).

El script imprime un resumen (totales, conteo por departamento, granel vs pieza).

---

## 3. Importar en la web

_Catálogo de productos → **Importar**_ → elegir el archivo.

El importador acepta **CSV, Excel (.xlsx/.xls) y JSON**, de cualquier usuario (no solo
el conversor). Reconoce las columnas automáticamente; si no, ofrece **mapeo manual**
de columnas. Columnas soportadas (con alias): `codigo/sku`, `descripcion/nombre`,
`precio`, `costo`, `mayoreo`, `existencia/stock`, `iva`, `departamento/categoria`,
`marca`, `proveedor`, `tipo_venta`, `activo`. Hay botón **Descargar plantilla CSV**.

Qué hace:

- Crea **categorías** y **proveedores** faltantes por nombre (reutiliza los globales).
- Detecta **duplicados** por código de barras **y por SKU**, y deja elegir:
  **omitir** (default, no toca nada), **actualizar solo precio/costo**, o
  **sobrescribir con el archivo** — todo vía `patch_product` (merge NO destructivo:
  no borra IVA/categoría/proveedor ni códigos secundarios).
- Ajusta **existencias** con `set_stock_levels` (ajuste absoluto e **idempotente**:
  re-importar el mismo archivo no duplica stock; fija el costo promedio con el costo
  del producto).
- IVA por producto: por columna `iva` o, en su defecto, un selector global
  (0 % alimentos / 16 % / 8 % frontera). El precio es **IVA-incluido**; el IVA solo
  afecta la contabilidad, no el precio cobrado.
- Da de alta los nuevos con `upsert_product`, con barra de progreso y reporte de
  incidencias descargable.

## 3b. Exportar base (respaldo reimportable)

_Catálogo de productos → **Exportar base**_ descarga un CSV con todo el catálogo en
las columnas canónicas (incluye código de barras, existencias y mayoreo). Sirve como
**respaldo** y para mover la base entre sucursales/instalaciones: ese mismo CSV se
puede volver a subir con **Importar** (round-trip). Las existencias se exportan solo
para productos con control de inventario, para no forzar stock 0 al reimportar.

### Mapeo de campos

| Origen (`pdvdata.fdb`)     | Destino (sistema nuevo)            |
| -------------------------- | ---------------------------------- |
| `PRODUCTOS.CODIGO`         | `sku` + `barcode`                  |
| `PRODUCTOS.DESCRIPCION`    | `name`                             |
| `PRODUCTOS.TVENTA` (U/D)   | `base_unit` pieza/peso + `is_weighed` |
| `PRODUCTOS.PVENTA` (pesos) | `price` (centavos)                 |
| `PRODUCTOS.PCOSTO` (pesos) | `cost` (centavos)                  |
| `PRODUCTOS.DEPT`           | `category` (vía `DEPARTAMENTOS.ID → NOMBRE`) |

### Notas de la base analizada (12 MB, ODS 10)

- **PRODUCTOS**: 1144 = mercancía real de la tienda.
- **PRODUCTOS_BASE**: 9469 = catálogo de referencia que trae el software (no se importa).
- **DEPARTAMENTOS** (en claro): `Dulceria`, `Miscelanea`, `Cereales`, `- Sin Departamento -`.
  La tabla `DEPTS` (41 filas) está **ofuscada** y en desuso; el FK real es a `DEPARTAMENTOS`.
- Sin control de stock (`DINVENTARIO = -1`), sin impuestos por producto, sin componentes.
