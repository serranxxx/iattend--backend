const forge = require('node-forge');

// Patch node-forge to handle EC certificates (e.g., Apple WWDR G4+).
// forge only supports RSA; EC certs throw "OID is not RSA" during parsing.
// Strategy: store the raw ASN.1 in a stub on parse failure, return it as-is on serialize.
(function patchForgeForEC() {
    const origFromPem = forge.pki.certificateFromPem.bind(forge.pki);
    const origFromAsn1 = forge.pki.certificateFromAsn1.bind(forge.pki);
    const origToAsn1 = forge.pki.certificateToAsn1.bind(forge.pki);

    forge.pki.certificateFromAsn1 = function (obj, computeHash) {
        try {
            return origFromAsn1(obj, computeHash);
        } catch (e) {
            if (e.message && e.message.includes('OID is not RSA')) {
                return { _isECStub: true, _rawAsn1: obj };
            }
            throw e;
        }
    };

    forge.pki.certificateFromPem = function (pem, computeHash, strict) {
        try {
            return origFromPem(pem, computeHash, strict);
        } catch (e) {
            if (e.message && e.message.includes('OID is not RSA')) {
                const der = forge.pem.decode(pem)[0].body;
                const asn1Obj = forge.asn1.fromDer(der);
                return { _isECStub: true, _rawAsn1: asn1Obj };
            }
            throw e;
        }
    };

    // When forge serializes the certificate chain in PKCS7, return raw ASN.1 for EC stubs.
    forge.pki.certificateToAsn1 = function (cert) {
        if (cert && cert._isECStub) return cert._rawAsn1;
        return origToAsn1(cert);
    };
}());

const { PKPass } = require('passkit-generator');
const path = require('path');

const MODEL_PATH = path.join(__dirname, '..', '..', 'models', 'wallet', 'pass.pass');

// Extracts PEM-encoded cert and unencrypted private key from a P12 buffer
function extractFromP12(p12Buffer, passphrase) {
    const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, passphrase);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certList = certBags[forge.pki.oids.certBag] || [];
    if (!certList.length) throw new Error('No certificate found in P12');
    const signerCert = Buffer.from(forge.pki.certificateToPem(certList[0].cert), 'utf-8');

    let key;
    const shroudedBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const shroudedList = shroudedBags[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
    if (shroudedList.length) {
        key = shroudedList[0].key;
    } else {
        const keyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
        const keyList = keyBags[forge.pki.oids.keyBag] || [];
        if (!keyList.length) throw new Error('No private key found in P12');
        key = keyList[0].key;
    }
    const signerKey = Buffer.from(forge.pki.privateKeyToPem(key), 'utf-8');

    return { signerCert, signerKey };
}

// Converts a DER or PEM buffer to PEM using raw base64 wrap (works for EC certs too).
function toPem(buffer) {
    const str = buffer.toString('utf-8');
    if (str.trimStart().startsWith('-----BEGIN')) return buffer;
    const b64 = buffer.toString('base64');
    const lines = b64.match(/.{1,64}/g).join('\n');
    return Buffer.from(`-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----\n`, 'utf-8');
}

// Normalizes any CSS color string to the "rgb(r, g, b)" format Apple Wallet expects.
function toWalletColor(color, fallback = 'rgb(10, 10, 10)') {
    if (!color) return fallback;
    const s = color.trim();
    const rgbMatch = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgbMatch) return `rgb(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]})`;
    const hexMatch = s.match(/^#([0-9a-f]{3,8})$/i);
    if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `rgb(${r}, ${g}, ${b})`;
    }
    return fallback;
}

// Downloads a remote image and returns it as a Buffer.
// Aborts after 8 s to avoid hanging the pass generation request.
async function fetchImageBuffer(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Failed to fetch image (${res.status}): ${url}`);
        return Buffer.from(await res.arrayBuffer());
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Generates an Apple Wallet posterEventTicket .pkpass buffer for a guest.
 *
 * Pass layout (iOS 16+):
 *   [logo top-left]          [date / time top-right]
 *   [full-cover event image as background]
 *   [glassmorphic footer]
 *   EVENT NAME
 *   guest name · Mesa X
 *   [QR barcode]
 *
 * Falls back to a standard eventTicket strip layout on older iOS.
 *
 * @param {object} data
 * @param {string|number} data.guestId
 * @param {string} data.guestName
 * @param {string} data.eventName
 * @param {string} data.eventDate       ISO date string (e.g. "2026-12-01T00:00:00")
 * @param {string} [data.eventTime]
 * @param {string|number} [data.tableNumber]
 * @param {string} [data.coverImageUrl]  URL of the event cover image
 * @param {string} [data.primaryColor]   CSS color used as pass background (legacy fallback)
 * @param {string} [data.accentColor]    CSS color used for text (legacy fallback)
 * @returns {Promise<Buffer>}
 */
async function generateWalletPass({ guestId, guestName, eventName, eventDate, eventTime, tableNumber, coverImageUrl, primaryColor, accentColor }) {
    const p12B64 = process.env.APPLE_WALLET_P12_BASE64;
    const wwdrB64 = process.env.APPLE_WWDR_CERT_BASE64;
    const passphrase = process.env.APPLE_WALLET_CERT_PASSWORD;

    const missing = [!p12B64 && 'APPLE_WALLET_P12_BASE64', !wwdrB64 && 'APPLE_WWDR_CERT_BASE64', !passphrase && 'APPLE_WALLET_CERT_PASSWORD'].filter(Boolean);
    if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);

    const p12Buffer = Buffer.from(p12B64, 'base64');
    const wwdrBuffer = Buffer.from(wwdrB64, 'base64');

    if (p12Buffer.length === 0) throw new Error('APPLE_WALLET_P12_BASE64 decoded to empty buffer — check the value in DigitalOcean');
    if (wwdrBuffer.length === 0) throw new Error('APPLE_WWDR_CERT_BASE64 decoded to empty buffer — check the value in DigitalOcean');

    const { signerCert, signerKey } = extractFromP12(p12Buffer, passphrase);
    const wwdr = toPem(wwdrBuffer);

    const [, month, day] = eventDate.split('T')[0].split('-');
    const months = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    const shortDate = `${months[Number(month) - 1]} ${Number(day)}`;

    const bgColor = toWalletColor(primaryColor, 'rgb(255, 255, 255)');
    const fgColor = toWalletColor(primaryColor, 'rgb(255, 255, 255)');
    const tableLabel = tableNumber != null ? String(tableNumber) : 'Pendiente';

    const pass = await PKPass.from({
        model: MODEL_PATH,
        certificates: { wwdr, signerCert, signerKey, signerKeyPassphrase: passphrase },
    }, {
        passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID,
        teamIdentifier: process.env.APPLE_TEAM_ID,
        serialNumber: `iattend-${guestId}-${Date.now()}`,
        description: eventName,

        // Colors — used on older iOS; iOS 18+ auto-derives them from the cover image
        backgroundColor: bgColor,
        foregroundColor: fgColor,
        labelColor: fgColor,

        // iOS 18+: derive text colors automatically from the background image
        useAutomaticColors: true,

        // iOS 18.1+: branding text next to the logo
        eventLogoText: 'I attend',

        // Structured data for Siri / Spotlight / Wallet search
        semantics: {
            eventName,
            eventType: 'PKEventTypeSocialGathering',
            attendeeName: guestName,
            silenceRequested: false,
        },
    });

    // preferredStyleSchemes is already set in pass.json template;
    // the setter would require the type to be resolved first, so we rely on the template.

    // ── Field layout ──────────────────────────────────────────────────────────
    // Header top-right: date stacked above time
    pass.headerFields.push(
        { key: 'date', label: shortDate, value: eventTime, textAlignment: 'PKTextAlignmentRight' }
        
    );

    // Primary: event name — large, center-bottom in posterEventTicket
    pass.primaryFields.push({ key: 'event', label: '', value: eventName });

    // Secondary: guest name
    pass.secondaryFields.push({ key: 'guest', label: 'Nombre', value: guestName });

    // Auxiliary: table number
    pass.auxiliaryFields.push({ key: 'table', label: 'Mesa', value: tableLabel });

    // QR encodes guestId for scanner verification
    pass.setBarcodes(String(guestId));

    // ── Images ────────────────────────────────────────────────────────────────
    if (coverImageUrl) {
        try {
            const imgBuffer = await fetchImageBuffer(coverImageUrl);

            // posterEventTicket: full-cover background
            pass.addBuffer('background.png', imgBuffer);
            pass.addBuffer('background@2x.png', imgBuffer);
            pass.addBuffer('background@3x.png', imgBuffer);

            // eventTicket legacy: strip banner at top
            pass.addBuffer('strip.png', imgBuffer);
            pass.addBuffer('strip@2x.png', imgBuffer);
            pass.addBuffer('strip@3x.png', imgBuffer);

            // thumbnail: used as event badge in some Wallet views
            pass.addBuffer('thumbnail.png', imgBuffer);
            pass.addBuffer('thumbnail@2x.png', imgBuffer);
            pass.addBuffer('thumbnail@3x.png', imgBuffer);
        } catch (err) {
            console.warn('Could not fetch cover image for pass:', err.message);
        }
    }

    return pass.getAsBuffer();
}

module.exports = { generateWalletPass };
