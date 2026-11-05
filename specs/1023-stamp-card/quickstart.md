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

## 3. into-central

Cuando exista la spec gemela y su código:

1. Copia al VPS del central, fuera del repo y con permisos `600`:
   `pass-cert.pem`, `pass-key.pem`, `wwdr.pem` y el JSON de Google, por
   ejemplo en `/opt/into-central/secrets/wallet/`.
2. Agrega al `.env` del central (nombres propuestos; los fija su spec):
   ```
   APPLE_PASS_TYPE_ID=pass.center.into.stamps
   APPLE_TEAM_ID=<tu Team ID>
   APPLE_PASS_CERT_FILE=/run/secrets/wallet/pass-cert.pem
   APPLE_PASS_KEY_FILE=/run/secrets/wallet/pass-key.pem
   APPLE_PASS_KEY_PASSWORD=<la clave del .pem>
   APPLE_WWDR_CERT_FILE=/run/secrets/wallet/wwdr.pem
   GOOGLE_WALLET_ISSUER_ID=<tu Issuer ID>
   GOOGLE_WALLET_SERVICE_ACCOUNT_FILE=/run/secrets/wallet/google-service-account.json
   ```
3. `pnpm run doctor` del central debe decir «Apple Wallet: ok» y «Google
   Wallet: ok».
4. En el panel del central, marca el wallet en los planes Pyme y Empresa
   (Emprendedor y Comunidad quedan solo con la página web).

## 4. Cada CRM IntoSales

1. En el `.env` de la instancia: `STAMP_CARD=on`. Para los wallets, además
   `INTO_CENTRAL_URL=https://api.into.center` y la llave de licencia pegada
   en Ajustes → Plan. Reinicia el contenedor.
2. El dominio del CRM debe tener HTTPS público (ya lo tiene si funciona el
   webhook de WhatsApp). Apple exige HTTPS para el servicio web del pase.
3. Ajustes → **Tarjeta de sellos**: nombre, sellos, premio, condiciones,
   color, horas mínimas entre sellos, frase y respuesta de alta.
4. Descarga el **cartel del mostrador** e imprímelo. Si quieres el «acerca tu
   celular», compra stickers **NFC NTAG213** y graba en ellos el enlace que
   muestra la pantalla, con una app como NFC Tools.
5. **Opcional:** para avisar por WhatsApp al completar la tarjeta, crea en
   WhatsApp Manager una plantilla de categoría **Utilidad** (por ejemplo,
   «{{1}}, completaste tu tarjeta en {{2}}. Pide tu premio en tu próxima
   visita.»), espera la aprobación y elígela en la pantalla.
6. **Prueba:** escribe la frase desde otro WhatsApp, abre el enlace, guarda
   la tarjeta en tu iPhone y en un Android de prueba, suma un sello desde el
   panel y comprueba que ambos se actualizan.

## 5. Pendientes que no son técnicos

- Precio: si hay un tope de tarjetas en wallet por plan (el wallet ya se
  decidió para Pyme y Empresa).
- Texto de consentimiento en la respuesta de alta y revisión de la política
  de privacidad de into.center (into firma los pases).
- Rubros nuevos en el catálogo del central (cafetería, barbería, salón,
  gimnasio…) para la ampliación a cualquier negocio.
