# Defect Formation Explorer

**[Open the online app](https://cmku-dft.github.io/formation-energy-plot/)**

A browser-based app for plotting DFT defect formation energies and thermodynamic charge-transition levels, including extrinsic dopants. Adapted from the HTML prototype supplied by the repository owner. No account, installation, backend or API key is required.

## Using the app

1. Replace the illustrative CuInSe₂ example with your host formula, formation enthalpy **per formula exactly as entered**, pristine-supercell total energy, VBM and positive band gap.
2. Supply consistent elemental reference energies **per atom**. For an oxygen molecule, divide its total energy by two. Use raw bulk and defect energies from matching supercells and the same calculation settings/reference convention. When you change the host formula, references for new elements start **blank** (never a silent zero); defect plots stay disabled until they are filled in.
3. Paste or upload a defect CSV/TSV. The atom-count changes Δn can be read from standard defect names, so element columns are optional (see **Δn from defect names** below). If you give element columns, include every host element. Positive counts mean atoms **added**; negative counts mean atoms **removed**. Each defect name must have the same composition across its charge states.
4. Paste or upload competing-phase formation enthalpies. Leave the phase table empty for elemental bounds only. Click **Calculate** (or **Load defects / Load phases**) after editing.
5. Choose a stability vertex, or edit the independent Δμ values. The remaining potential follows the host equality. Outside-region conditions are marked; they are not equilibrium growth conditions.
6. Use the publication controls for one to three panels, colors, labels, size, ticks and fonts. Line-end labels are placed in a reserved strip to the right of each panel so they never cover the curves; charge labels are moved along or below their segment to avoid one another and the panel caption. Download a native XmGrace project with **Grace (.agr)**, editable SVG, or PNG at 300/600 dpi. Open the AGR in XmGrace with **File → Open**. Each publication panel is a graph, each visible defect envelope is a separate XY set, and enabled transition markers are separate point sets. Edit line styles in Set appearance and tick spacing or axis labels in Axis properties. Native Grace fonts and label placement can differ from the browser preview. PNG files carry both the requested pixel size and resolution metadata.
7. **Save inputs** downloads a JSON file containing system values, dopants and their settings, reference energies, input tables and the selected chemical potentials. **Open inputs** restores it (files saved by earlier versions still open). Figure styling is not included. Reloading the page loads the example; inputs are not automatically stored.

### Bundled examples

The `examples/` folder holds input files in the **Save inputs** format. Load them with the buttons under **Examples and reset**, or download one and open it with **Open inputs / Lab session**. All numbers are illustrative: they were chosen to show the format and typical behaviour, not taken from a real calculation.

- `ZnO_native_defects.json` (no element columns: Δn comes from the names): V_O (deep, negative-U ε(2+/0)), V_Zn (acceptor, ε(0/−) and ε(−/2−)) and Zn_i (shallow donor), Zn-rich and O-rich limits.
- `ZnO_Al_doped.json` (with element columns, which are checked against the names): the same defects plus Al_Zn and Al_i, with Δμ_Al set by Al₂O₃ (`Δμ_Al = [ΔHf(Al2O3) − 3Δμ_O]/2`). The phase table contains a commented-out `ZnAl2O4` line. Remove the `#` and press **Calculate** to see the spinel become the limiting phase. Next to ZnO it is the real solubility limit, because ZnO + Al₂O₃ → ZnAl₂O₄ is exothermic.

### Defect table example (illustrative values only)

```csv
defect,charge,E_tot,E_corr,Cu,In,Se
V_Cu,0,-1119.0167,0.00,-1,0,0
V_Cu,-1,-1116.9424,0.11,-1,0,0
Cu_In,0,-1121.8867,0.00,1,-1,0
Cu_In,-1,-1119.5524,0.11,1,-1,0
Cu_In,-2,-1117.1481,0.44,1,-1,0
In_Cu,2,-1126.4253,0.44,-1,1,0
In_Cu,1,-1123.6910,0.11,-1,1,0
In_Cu,0,-1121.0867,0.00,-1,1,0
V_Se,2,-1121.8853,0.44,0,0,-1
V_Se,1,-1118.6510,0.11,0,0,-1
V_Se,0,-1116.0367,0.00,0,0,-1
Cu_i,1,-1127.6410,0.11,1,0,0
Cu_i,0,-1125.1767,0.00,1,0,0
```

`E_corr` is optional (omitting the column means zero); when present every cell must be numeric. Use integer charge states and integer changes in atom counts. Quoted names containing commas are supported. Each record must occupy one line. Multiple configurations of the same defect and charge are allowed: the lowest energy is used.

### Δn from defect names

Δn depends only on which atoms are added or removed, which standard notation already states. Each part of a name is `X_Y`: X is the added atom (or `V` / `Vac` for a vacancy) and Y is the site (an element, or `i` / `int` for an interstitial).

| Name | Δn |
|---|---|
| `V_O`, `Vac_O` | O −1 |
| `Zn_i`, `Zn_int` | Zn +1 |
| `Zn_O` (antisite) | Zn +1, O −1 |
| `Al_Zn` (dopant) | Al +1, Zn −1 |
| `Al_Zn+V_Zn` (complex; `+` or `-` joins parts) | Al +1, Zn −2 |

Text in `()`, `[]` or `{}` and charge marks such as `^2+` are ignored, so `V_O(split)`, `O_i[oct]` and `V_O^{2+}` work. These rules apply:

- **No element columns:** Δn is read from the names. A name in another notation (for example `DX`) is an error that asks for element columns. Nothing is guessed.
- **Element columns given:** they are used, and every standard name is checked against them. A mismatch (wrong sign, swapped column, forgotten dopant column) is an error showing both readings. Names in other notation are accepted on the columns alone.
- **An element that is neither in the host nor declared as a dopant** (for example `Mn_Zn` without Mn under Extrinsic dopants) is an error asking you to declare it.
- **When vanadium is in the system,** `V_X` is ambiguous. Write vacancies as `Vac_X`, or give element columns.

A summary under the defect table shows the Δn used for each defect and where it came from (name, or columns checked against the name).

### Competing-phase table

```csv
phase,dHf
Cu2Se,-0.54
CuSe,-0.41
In2Se3,-2.99
CuIn5Se8,-8.98
```

These are the **illustrative demo** values. Formula parsing supports parentheses, brackets and fractional stoichiometry. For named phases or polymorphs, supply explicit nonnegative element columns instead; omitted element columns mean zero. Energies must correspond to the stoichiometry provided in that row. Optional columns `energyType` (total/formation), `basis` (formula/cell/atom) and `units` (formula units per cell) convert raw energies; defaults are formation and formula.

### Extrinsic dopants

1. List the dopants in **Extrinsic dopants**, for example `Mn, Cr, Co` (up to four). Each one gets an elemental reference field: the energy per atom of the dopant's elemental ground state (for example bcc/α-Mn metal), computed with the same settings as everything else.
2. Add a column for each dopant in the defect table. For Mn on a Zn site in ZnO, use `Zn = −1, Mn = +1`; for an Mn interstitial, `Mn = +1`. A missing dopant column means zero, so existing intrinsic-defect tables work unchanged.
3. Add the dopant's **solubility-limiting phases** to the competing-phase table: every compound that the dopant could form with the host elements. For a metal oxide host this means the dopant oxides (MnO, Mn₃O₄, Mn₂O₃, MnO₂ …) and any known ternary phases with the host cation (for example ZnMn₂O₄). Phases containing a dopant bound only that dopant's chemical potential. They do not change the host stability region, because the dopant is treated as dilute.
4. Pick how Δμ of each dopant is set, in the panel below the Δμ inputs:
   - **Solubility limit (auto)**, the default and the physically consistent choice: the lowest bound from all dopant phases and the elemental limit. The panel shows the result and the limiting phase at every vertex.
   - **In equilibrium with a chosen phase**: forces Δμ onto one phase's bound. If another phase would then precipitate, the app reports it, because that condition is above the solubility limit.
   - **Fixed Δμ**: a manual value, also checked against every bound.

Illustrative ZnO:Mn tables (made-up numbers, for format only):

```csv
defect,charge,E_tot,E_corr,Zn,O,Mn
Mn_Zn,1,-106.0,0.1,-1,0,1
Mn_Zn,0,-104.4,0.0,-1,0,1
V_O,2,-95.5,0.3,0,-1,0
V_O,0,-90.2,0.0,0,-1,0
```

```csv
phase,dHf
ZnO2,-4.0
MnO,-3.9
Mn2O3,-9.9
MnO2,-5.5
ZnMn2O4,-13.6
```

#### Physics of the dopant chemical potential

The formation energy of a dopant-containing defect uses the same expression as intrinsic defects, with the dopant included in the sum: `−Δn_D (μ_D_ref + Δμ_D)`. Following Van de Walle & Neugebauer, *J. Appl. Phys.* **95**, 3851 (2004), and Freysoldt *et al.*, *Rev. Mod. Phys.* **86**, 253 (2014), Δμ_D is bounded by the condition that no dopant phase precipitates. For a phase D_a H1_b1 H2_b2 …,

`a Δμ_D + Σ b_i Δμ_i ≤ ΔHf(phase)` ⇒ `Δμ_D ≤ [ΔHf(phase) − Σ b_i Δμ_i] / a`,

together with `Δμ_D ≤ 0` (dopant metal). The **solubility limit** at a host condition is the smallest of these bounds. The bound therefore depends on the host Δμ: with MnO₂, `Δμ_Mn = ΔHf(MnO₂) − 2Δμ_O`. That is low under O-rich growth and high under O-poor growth, where a lower oxide (such as MnO) or Mn metal usually takes over as the limiting phase. Do not take Δμ_Mn from MnO₂ (or any single phase) without checking the others: under O-poor conditions the MnO₂ line can lie *above* the MnO and Mn-metal limits, which is an impossible condition. The auto mode handles this by always taking the minimum.

Consistency points for oxides and other compounds:

- All formation enthalpies (host, intrinsic competing phases and dopant phases) must use the same elemental references, including the same O₂ reference and any O₂ overbinding/fitted-elemental-reference correction.
- With DFT+U on the dopant's d states, mixing +U oxides with a non-U metal reference is a known source of error in ΔHf (see the mixing schemes of Jain *et al.*, *Phys. Rev. B* **84**, 045115 (2011)). Use one consistent scheme for the dopant metal, its oxides and the defect supercells.
- Magnetic dopants (Mn, Cr, Co …) need a consistent spin state across the defect cell and the reference phases.

## Stability-only calculations and Chemical Potential Lab files

Chemical-potential stability is calculated independently of defect inputs. Enter the host formula, its formation enthalpy in eV per formula unit, and competing phases, then Calculate. Empty or invalid defect entries do not clear the stability diagram. Defect plots and exports remain disabled until their own inputs (including bulk energy, VBM, gap and elemental references) are valid.

Use **Open inputs / Lab session** to open `chemical-potential-session.json` saved by Chemical Potential Lab (schema version 1). This replaces the stability inputs and clears old defect data, dopants and electronic inputs; save your work first. Formation and total energies with formula/atom/cell bases are supported. Cell energies are divided by formula units per cell; per-atom energies are multiplied by the atoms in the entered formula. Elemental references are subtracted only in total-energy mode. Disabled phases are omitted. Missing references remain blank rather than being assumed to be zero.

**Save for Chemical Potential Lab** exports a compatible binary/ternary session with normalized formation enthalpies, active host phases, references and the chosen growth condition. Defects, dopants, dopant phases and figure styling are not included. Four-element Explorer hosts cannot be exported because Lab supports only two or three elements. Use **Save inputs** for the Explorer's full input file.

## Model and limits

The formation-energy convention is:

`Ef = Edefect − Ebulk − Σ Δni (μi_ref + Δμi) + q (EVBM + EF) + Ecorr`

The sum runs over host elements and declared dopants. Here `EF` ranges from zero at the VBM to the band gap. Each charge state is a straight line; the app computes the lower envelope and its in-gap intersections. Correction energies must be supplied externally. Include potential alignment only once, consistently with the correction scheme used. See the [FHI-aims formation-energy convention](https://fhi-aims.org/uploads/manual/Ch4/S11.html).

Chemical potentials satisfy `Σ ni Δμi = ΔHf(host)`, elemental bounds `Δμi ≤ 0`, and every supplied phase inequality `Σ mi Δμi ≤ ΔHf(phase)`. Dopant chemical potentials follow from the host condition as described above. Inputs must use consistent energy references; the app cannot verify DFT convergence or identify missing competing phases.

- Hosts with **2–4 elements** are supported. Binary hosts yield a line segment; ternary hosts a polygon; quaternary hosts are shown as a **2D projection** of the 3D stability polytope. Select actual vertices or the full potential inputs, not arbitrary points in a quaternary projection.
- Up to **four extrinsic dopants**, treated in the dilute limit. A phase containing two dopants at once (for example MnCr₂O₄) is rejected, because co-doping limits are not modelled. Undeclared element columns are rejected rather than silently omitted from the energy.
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

The automated tests cover formula/CSV validation, binary/ternary/quaternary constraints, infeasible hosts, atom-count signs, reference energies and corrections, transition levels, dopant solubility limits (including their dependence on host Δμ and ternary dopant phases), dopant formation energies, Δn from defect names and its cross-check against element columns, the bundled examples, publication label placement, publication SVG and PNG resolution metadata. Browser checks additionally cover rendering and exports.
