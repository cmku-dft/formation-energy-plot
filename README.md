# Defect Formation Explorer

**[Open the online app](https://cmku-dft.github.io/formation-energy-plot/)**

A browser-based app for plotting DFT defect formation energies and thermodynamic charge-transition levels. Adapted from the HTML prototype supplied by the repository owner. No account, installation, backend or API key is required.

## Using the app

1. Replace the illustrative CuInSe₂ example with your host formula, formation enthalpy **per formula exactly as entered**, pristine-supercell total energy, VBM and positive band gap.
2. Supply consistent elemental reference energies **per atom**. For an oxygen molecule, divide its total energy by two. Use raw bulk and defect energies from matching supercells and the same calculation settings/reference convention.
3. Paste or upload a defect CSV/TSV. Include every host element as a column. Positive atom counts mean atoms **added**; negative counts mean atoms **removed**. Each defect name must have the same composition across its charge states.
4. Paste or upload competing-phase formation enthalpies. Leave the phase table empty for elemental bounds only. Click **Calculate** (or **Load defects / Load phases**) after editing.
5. Choose a stability vertex, or edit the independent Δμ values. The remaining potential follows the host equality. Outside-region conditions are marked; they are not equilibrium growth conditions.
6. Use the publication controls for one to three panels, colors, labels, size, ticks and fonts. Download editable SVG or PNG at 300/600 dpi. PNG files carry both the requested pixel size and resolution metadata.
7. **Save inputs** downloads a JSON file containing system values, reference energies, input tables and the selected chemical potentials. **Open inputs** restores it. Figure styling is not included. Reloading the page loads the example; inputs are not automatically stored.

### Defect table example (illustrative values only)

```csv
defect,charge,E_tot,E_corr,Zn,O
V_O,0,-94.0,0.0,0,-1
V_O,1,-95.0,0.2,0,-1
V_Zn,0,-98.0,0.0,-1,0
```

`E_corr` is optional (omitting the column means zero); when present every cell must be numeric. Use integer charge states and integer changes in atom counts. Quoted names containing commas are supported. Each record must occupy one line. Multiple configurations of the same defect and charge are allowed: the lowest energy is used.

### Competing-phase table

```csv
phase,dHf
Cu2Se,-0.54
CuSe,-0.41
In2Se3,-2.99
CuIn5Se8,-8.98
```

These are the **illustrative demo** values. Formula parsing supports parentheses, brackets and fractional stoichiometry. For named phases or polymorphs, supply explicit nonnegative element columns instead; omitted element columns mean zero. Energies must correspond to the stoichiometry provided in that row.

## Model and limits

The formation-energy convention is:

`Ef = Edefect − Ebulk − Σ Δni (μi_ref + Δμi) + q (EVBM + EF) + Ecorr`

Here `EF` ranges from zero at the VBM to the band gap. Each charge state is a straight line; the app computes the lower envelope and its in-gap intersections. Correction energies must be supplied externally. Include potential alignment only once, consistently with the correction scheme used. See the [FHI-aims formation-energy convention](https://fhi-aims.org/uploads/manual/Ch4/S11.html).

Chemical potentials satisfy `Σ ni Δμi = ΔHf(host)`, elemental bounds `Δμi ≤ 0`, and every supplied phase inequality `Σ mi Δμi ≤ ΔHf(phase)`. Inputs must use consistent energy references; the app cannot verify DFT convergence or identify missing competing phases.

- Hosts with **2–4 elements** are supported. Binary hosts yield a line segment; ternary hosts a polygon; quaternary hosts are shown as a **2D projection** of the 3D stability polytope. Select actual vertices or the full potential inputs, not arbitrary points in a quaternary projection.
- **Extrinsic dopants are not yet supported**. Extra element columns are rejected rather than silently omitted from the energy.
- A skipped charge state is not by itself proof of negative-U behavior: the intermediate charge states must have been calculated. These are thermodynamic, not optical, transition levels.
- An infeasible host disables formation-energy exports. Invalid input clears previous plots instead of displaying stale or partially accepted results.
- Practical limits: 1,000 rows per table, 100 entries per defect, 20,000 boundary combinations, 1,000 tick subdivisions per axis and 25 megapixels per PNG. Reduce figure dimensions or use SVG for larger output.
- Data processing and downloads run locally in your browser. Google Fonts supplies interface fonts; fallback fonts work without it. There is no analytics or data upload.

## Updating the website

- Edit **`index.html`** for layout, instructions and styles.
- Edit **`app.js`** for parsing, calculations, charts and downloads.
- Commit changes to **`main`**. GitHub Actions runs checks and tests, then publishes GitHub Pages automatically. Watch **Actions → Check and publish app** for completion.
- Pull requests run checks without publishing. Failed checks prevent deployment. No hosting credentials are stored in the repository.
- `defect-formation-explorer.html` redirects to the home page so the original file link keeps working; edit `index.html`, not that redirect.

For local development (Node 24 and Python 3):

```sh
npm run check
npm test
npm run build:pages
python3 -m http.server 8766 --bind 127.0.0.1
```

Open `http://127.0.0.1:8766/`. There are no npm dependencies to install. You can also open `index.html` locally with `app.js` alongside it; clipboard permissions may be more limited on file URLs.

The automated tests cover formula/CSV validation, binary/ternary/quaternary constraints, infeasible hosts, atom-count signs, reference energies and corrections, transition levels, publication SVG and PNG resolution metadata. Browser checks additionally cover rendering and exports.
