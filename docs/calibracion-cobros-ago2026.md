# Calibración del estimador — QuickBooks vs Reglas de Cobro

**Fuente:** QuickBooks "Sales by Product/Service Detail", Ene 2025 – Ago 2026
**Datos:** 14,214 líneas · 1,720 facturas · 113 clientes · $7.66M facturado

## ✅ Tarifas del PDF que los datos confirman (sin cambios)

| Servicio | Regla | Mediana real |
|---|---|---|
| Setup (Day) general | $750 típico | $750 |
| Setup (Night) | ~$1,050 | $1,050 |
| TMP Engineering Stamp | $550 | $550 |
| Traffic Management Plan | $400 | $400 |
| Parking Ban | $350 | $350 |
| Stockpile Signage | $450 | $450 |
| Windmaster + Sign | $3.00/día | $3.00 |
| Cones | $1.00 | $1.00 |
| No Parking | $1.50 | $1.50 |
| Barricadas | $2.50 | $2.50 |
| Sidewalk/Pedestrian | $0.50 | $0.50 |
| Barrel | $1.25 | $1.25 |
| ACQ | $50 | $50 |
| Flaggers | $40/h reg · $60/h OT | $40 / $60 |
| Message Board | $95/día | $95 |
| Arrow Board | $45/día | $45 |
| Custom Signs | $89.90 c/u | $89.90 (venta y renta) |

## 🔧 Correcciones aplicadas (el PDF estaba desactualizado)

| Servicio | PDF decía | Real (QB) | Aplicado |
|---|---|---|---|
| Arrow board **Truck** | $75/día | **$120/hora** | ✔ ahora por hora |
| Traffic Lights | $84/día | **$170/día** | ✔ |
| Arrow-board **Trailer** | (no existía) | **$65/día** ($144K facturados) | ✔ producto nuevo |
| Delivery / Pick up | (no existía) | **$225/viaje** (85–450) | ✔ tarifa disponible |
| Mobile Set Up | (no existía) | **$120** | ✔ tarifa disponible |
| Telus setup | $1,060 día / $1,425 noche | **$750 día / $950 noche** | ✔ |
| North Star setup | $1,250 | **$850** | ✔ |
| Kobi "−20%" | $512 con descuento | **$650 mediana real** | ✔ tarifa directa |
| Premium nocturno | +$300 | **+$200** | ✔ |

## 📇 Client cards calibradas (mediana real de Setup/Day, n = # setups facturados)

| Cliente | Tarifa | n | | Cliente | Tarifa | n |
|---|---|---|---|---|---|---|
| LBCO | $750 | 262 | | Smart Communications | $950 | 23 |
| **Bow Mark** | **$400** | 240 | | Dominium | $750 | 22 |
| Kobi | $650 | 205 | | **Kang Construction** | **$1,150** | 21 |
| Telus | $750 | 122 | | PCL | $850 | 20 |
| LTS Build | $850 | 97 | | Turn Group | $650 | 19 |
| Kidco | $950 | 80 | | TA Excavating | $750 | 18 |
| Blue-Con | $750 | 63 | | McIntyre Crane | $750 | 15 |
| Cannex | $750 | 62 | | Alpine Glass | $850 | 15 |
| North Star | $850 | 60 | | Borger | $950 | 15 |
| WPT Electronics | $900 | 54 | | Birchcliff | $750 | 14 |
| Maf-Worx | $750 | 41 | | ALSA Road | $650 | 13 |
| Precision Underground | $875 | 32 | | Fibercomm / Marmot | $750 | 28/24 |

Los clientes sin card usan la matriz industria × complejidad del PDF.

## 📌 Notas para revisar con el facturador

- **Bow Mark a $400** es muy distinto al resto — son setups diarios pequeños; la card lo refleja, pero sus trabajos grandes (p75 $600) pueden requerir ajuste manual.
- **Hoarding Permits** ($220K facturados) no están en las reglas — son pass-through grandes; se facturan manual.
- Existen cargos ocasionales sin regla automática: Cancellation Fee (~$325), Traffic Check ($300–450), Admin Fee, Out of City Fee (~$364–1,526), Sign Installation ($250), Message Board installation ($225). Están disponibles como líneas manuales.
- El auto-quote sigue guardando su sugerencia con cada factura (`suggestedJson`); pídele a Claude "revisa lo aprendido" periódicamente para el siguiente ciclo de ajuste.
