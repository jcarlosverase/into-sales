# 1023 — Configuración de la tarjeta de sellos

Pasos en orden. Los de Apple y Google se hacen **una sola vez para into** y
sus credenciales van solo a into-central. Nunca van al repo, a un CRM de
cliente ni a un chat. Los del CRM se repiten por cliente.

## 1. Apple Wallet (ya tienes la cuenta de Apple Developer)

1. **Pass Type ID.** En [developer.apple.com/account](https://developer.apple.com/account)
   ve a Certificates, IDs & Profiles → Identifiers → «+» → **Pass Type IDs**.
   - Description: `into — Tarjeta de sellos`
   - Identifier: `pass.center.into.stamps`
2. **Solicitud de certificado (CSR) en tu Mac.** Acceso a Llaveros → menú
   Acceso a Llaveros → Asistente para certificados → «Solicitar un
   certificado de una autoridad de certificación». Pon tu correo y el nombre
   `into Pass Type`, elige «Guardado en el disco» y guarda el `.certSigningRequest`.
3. **Certificado.** En el Pass Type ID del paso 1 → «Create Certificate» →
   sube el CSR → descarga `pass.cer` y ábrelo con doble clic (queda en
   Acceso a Llaveros, en «Mis certificados»).
4. **Exporta el `.p12`.** En «Mis certificados», clic derecho sobre
   «Pass Type ID: pass.center.into.stamps» → Exportar → `pass.p12`, con una
   contraseña fuerte (guárdala en tu gestor de contraseñas).
5. **Certificado intermedio de Apple (WWDR G4).** Descarga
   `AppleWWDRCAG4.cer` de [apple.com/certificateauthority](https://www.apple.com/certificateauthority/).
6. **Team ID.** En developer.apple.com → Membership details, anota el Team ID
   (10 caracteres).
7. **Pásalos a PEM** en la Terminal, en la carpeta de los archivos:
   ```bash
   openssl pkcs12 -in pass.p12 -clcerts -nokeys -out pass-cert.pem
   openssl pkcs12 -in pass.p12 -nocerts -out pass-key.pem   # pide la clave del .p12 y una nueva para el .pem
   openssl x509 -inform der -in AppleWWDRCAG4.cer -out wwdr.pem
   ```
   El `openssl` de la Mac es LibreSSL y no conoce `-legacy` («unknown option
   '-legacy'»); no le hace falta. Si da «mac verify failure» con la clave
   correcta, usa el OpenSSL de Homebrew con `-legacy`:
   `$(brew --prefix openssl@3)/bin/openssl pkcs12 -legacy -in pass.p12 …`.
   **Si el Llavero da problemas** («certificate is not trusted» o sin opción
   .p12): instala primero `AppleWWDRCAG4.cer` (paso 5) en el llavero *login*,
   y busca el certificado en **Mis certificados**, donde debe tener un ▸ con
   su llave. Si no la tiene, la llave quedó en otra Mac: usa este camino sin
   Llavero en lugar de los pasos 2 a 4 y 7:
   ```bash
   openssl genrsa -out pass-key-plain.pem 2048
   openssl req -new -key pass-key-plain.pem -out pass.csr -subj "/CN=into Pass Type/C=PE"
   # sube pass.csr en el Pass Type ID → «Create Certificate» → descarga pass.cer
   openssl x509 -inform der -in pass.cer -out pass-cert.pem
   openssl pkcs8 -topk8 -v2 aes-256-cbc -in pass-key-plain.pem -out pass-key.pem   # pide la contraseña
   rm pass-key-plain.pem
   openssl x509 -inform der -in AppleWWDRCAG4.cer -out wwdr.pem
   ```
8. **Recordatorio.** El certificado vence al año. Ponte un recordatorio un
   mes antes: al renovarlo se repiten los pasos 2 a 4 y 7, y el Pass Type ID
   no cambia.

## 2. Google Wallet

1. **Perfil de emisor.** Entra a la [consola de Google Pay y Wallet](https://pay.google.com/business/console)
   con la cuenta de Google de into, crea el perfil de empresa «into» y abre
   **Google Wallet API**. Anota el **Issuer ID** (un número largo).
2. **Proyecto de Google Cloud.** En [console.cloud.google.com](https://console.cloud.google.com)
   crea el proyecto `into-wallet` y activa la API **Google Wallet API**
   (APIs y servicios → Biblioteca).
3. **Cuenta de servicio.** IAM y administración → Cuentas de servicio →
   «Crear» → `wallet-signer`, sin roles de proyecto. Luego, en Claves →
   «Agregar clave» → JSON, descarga el archivo.
4. **Dale acceso al emisor.** En la consola de Wallet → Usuarios → invita el
   correo de la cuenta de servicio (`wallet-signer@into-wallet.iam.gserviceaccount.com`)
   con el rol **Desarrollador**.
5. **Usuarios de prueba.** Mientras Google no apruebe la publicación, solo
   las cuentas de prueba pueden guardar pases. Agrega tu Gmail y el de quien
   pruebe en la consola de Wallet → Google Wallet API → «Usuarios de prueba».
6. **Pide acceso de publicación** cuando tengas una tarjeta de prueba
   funcionando: Google Wallet API → «Solicitar acceso de publicación». Pide
   capturas del pase y una descripción del uso. La aprobación tarda unos días.

## 3. into-central (una sola vez)

Esto se hace en el VPS donde corre into-central. La carpeta del central es `/opt/into-central`.

### 3.1. Sube los 4 archivos al servidor

Desde la Terminal de tu Mac, en la carpeta donde están los archivos (cambia `usuario` e `IP` por los de tu VPS):

```bash
scp pass-cert.pem pass-key.pem wwdr.pem google-service-account.json usuario@IP:~/
```

### 3.2. Ponlos en su carpeta con permisos cerrados

El instalador deja el código del central en `/opt/into-central/src`, y ahí es donde Docker busca la carpeta `secrets/wallet`. Por eso los archivos van en `/opt/into-central/src/secrets/wallet`. Esa carpeta está en `.gitignore`, así que las actualizaciones no la tocan.

Entra al servidor con `ssh usuario@IP` y corre:

```bash
cd /opt/into-central
DC="sudo docker compose -p into-central --env-file .env -f src/docker-compose.yml -f src/deploy/docker-compose.vps.yml"
sudo mkdir -p src/secrets/wallet
sudo mv ~/pass-cert.pem ~/pass-key.pem ~/wwdr.pem ~/google-service-account.json src/secrets/wallet/
CENTRAL_UID=$($DC run --rm --no-deps --entrypoint id app -u)
echo "$CENTRAL_UID"     # debe mostrar un número, por ejemplo 100
sudo chown -R "$CENTRAL_UID" src/secrets/wallet
sudo sh -c 'chmod 600 src/secrets/wallet/* && chmod 700 src/secrets/wallet'
sudo ls -l src/secrets/wallet   # 4 archivos -rw-------
```

Así solo el usuario del contenedor del central puede leer esos archivos. Dentro del contenedor, la carpeta aparece como `/run/secrets/wallet/`.

### 3.3. Agrega las variables al `.env` del central

```bash
sudo nano /opt/into-central/.env
```

Al final del archivo, pega este bloque y cambia lo que está entre `< >` por tus valores de las secciones 1 y 2. Las rutas de los archivos van **tal cual**, porque son las de dentro del contenedor:

```
APPLE_PASS_TYPE_ID=pass.center.into.stamps
APPLE_TEAM_ID=<tu Team ID>
APPLE_PASS_CERT_FILE=/run/secrets/wallet/pass-cert.pem
APPLE_PASS_KEY_FILE=/run/secrets/wallet/pass-key.pem
APPLE_PASS_KEY_PASSWORD=<contraseña de pass-key.pem>
APPLE_WWDR_CERT_FILE=/run/secrets/wallet/wwdr.pem
GOOGLE_WALLET_ISSUER_ID=<tu Issuer ID>
GOOGLE_WALLET_SERVICE_ACCOUNT_FILE=/run/secrets/wallet/google-service-account.json
```

Guarda con Ctrl+O, Enter, y sal con Ctrl+X.

### 3.4. Reinicia y comprueba

```bash
cd /opt/into-central && sudo docker compose -p into-central --env-file .env -f src/docker-compose.yml -f src/deploy/docker-compose.vps.yml up -d
```

Abre el panel del central y ve a **Estado**. «Apple Wallet» y «Google Wallet» deben salir en verde. Si una sale en rojo, la página dice qué falló (un archivo que no se lee, una contraseña que no abre la llave) sin mostrar nada secreto.

### 3.5. Activa el wallet en los planes

En el panel del central, ve a **Planes** y abre **Pyme**. Marca «Incluye Apple y Google Wallet (tarjeta de sellos)» y guarda. Haz lo mismo con **Empresa**. Emprendedor y Comunidad quedan sin marcar.

## 4. Cada CRM IntoSales

Cada cliente tiene su carpeta en el VPS: `/opt/into-sales/<cliente>`.

### 4.1. La llave de licencia del cliente (en el central)

En el panel del central, ve a **Clientes** y abre el cliente. Comprueba que su plan sea Pyme o Empresa si quieres wallet.

- Si lo acabas de crear, la llave se mostró **una sola vez** al crearlo. Cópiala.
- Si no la tienes guardada, usa **Rotar llave** en la tarjeta «Llave de licencia». Sale una llave nueva y la anterior deja de funcionar al instante.

### 4.2. Enciende la tarjeta y actualiza el CRM

En el servidor, un solo comando actualiza el código, guarda la bandera en el `.env`, aplica las migraciones 0027 y 0028 y reinicia:

```bash
sudo GITHUB_TOKEN=<tu token> bash /opt/into-sales/<cliente>/src/deploy/install.sh --update --client <cliente> --env STAMP_CARD=on --central https://api.into.center
```

`--central` solo hace falta la primera vez; para el wallet es obligatorio. La llave de licencia **no** va en el `.env`.

Para reiniciar el CRM sin actualizarlo:

```bash
cd /opt/into-sales/<cliente>
sudo docker compose -p into-sales-<cliente> --env-file .env -f src/docker-compose.yml -f src/deploy/docker-compose.vps.yml up -d
```

En tu Mac, en desarrollo, la migración se aplica con `pnpm db:migrate`.

### 4.3. Pega la llave en el CRM

Entra al CRM del cliente como administrador. Ve a **Ajustes → Plan**, pega la llave del paso 4.1 y guarda. Debe mostrar el plan del cliente.

### 4.4. Configura la tarjeta

En **Ajustes → Tarjeta de sellos**, llena el nombre, los sellos, el premio, las condiciones, el color, las horas mínimas entre sellos, la frase de alta y la respuesta de alta. Pulsa «Crear tarjeta».

El cartel del mostrador aparece cuando el número de WhatsApp está conectado en **Ajustes → WhatsApp**.

### 4.5. Cartel y sticker

- Descarga el PNG o imprime el cartel desde la misma pantalla.
- Para el sticker NFC (NTAG213), copia el enlace que muestra la pantalla y grábalo con la app NFC Tools: «Escribir → Agregar registro → URL».

### 4.6. Aviso al completar (opcional)

Cada sello ya lo avisa el wallet. Si además quieres un WhatsApp cuando el
cliente junta todos los sellos, crea en WhatsApp Manager una plantilla de
categoría **Utilidad** (por ejemplo «{{1}}, completaste tu tarjeta en {{2}}.
Pide tu premio: {{3}}.»), espera la aprobación y elígela en Ajustes → Tarjeta
de sellos → «Avisar por WhatsApp al completarla». Con la ventana de 24 horas
abierta va un texto libre; sin plantilla y con la ventana cerrada, no se manda.

### 4.7. Prueba

1. Desde otro WhatsApp, escanea el cartel y envía la frase. Debe llegarte el enlace a tu tarjeta.
2. Abre el enlace en tu iPhone: debe salir «Agregar a Apple Wallet». En un Android, «Guardar en Google Wallet».
3. En la ficha del contacto, suma un sello. En menos de un minuto, la tarjeta del wallet debe mostrar el sello nuevo.

Los botones de wallet solo salen con `INTO_CENTRAL_URL`, la llave pegada, un
plan con wallet y el CRM en `https://`. Si no salen, revisa Ajustes → Salud
(«Servicio central de into» y «Tarjeta de sellos»).

## 5. Pendientes que no son técnicos

- Precio: si hay un tope de tarjetas en wallet por plan (el wallet ya se
  decidió para Pyme y Empresa).
- Texto de consentimiento en la respuesta de alta y revisión de la política
  de privacidad de into.center (into firma los pases).
- Rubros nuevos en el catálogo del central (cafetería, barbería, salón,
  gimnasio…) para la ampliación a cualquier negocio.
