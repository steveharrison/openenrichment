<p align="center">
  <img src="src/public/icon.svg" width="160" alt="Open Enrichment icon: a torn receipt touched by a magic wand">
</p>

# Open Enrichment

Many FinTech products display a nice merchant icon and human-readable name for transactions, instead of the plain text `SQ *BRICKFIELDS CHIPP` that appears on your bank statement. This relies on transaction enrichment, or some way to map these strings to their corresponding merchant details.

I encountered this problem while building https://thefinances.app, and wanted to solve it slightly differently. There are existing services like Plaid Enrich, https://ntropy.com, and https://www.triqai.com, but these all rely on sending transactions to their APIs for processing. While this may not be a big deal privacy-wise to FinTech apps and banks that already store all their customer information in the cloud, I wanted to build something that would work on the user’s actual device without sending their transaction details elsewhere.

This is where Open Enrichment comes in.

It’s a lightweight CSV file of many different merchants from around the world, corresponding transaction texts, and simple regular expressions to match those merchants. It's tiny, but hopefully can be expanded to get better coverage.

The quality of enrichment improves the more accurate data we feed in, so this repository is an attempt to curate a set of human-reviewed, accurate data of merchant and transaction mappings.

Feel free to build upon this and submit pull requests to add additional data. You’re welcome to use this data in your own enrichment services.

## How to use this data
- First strip payment processors from the transaction text. I’ve included an example function in this repository and some common processor prefixes.
- I've included a list of categories but you can construct your own using the MCC codes.
- When more than one rule matches, the longest matched substring wins. Length is measured on the text matched rather than on the pattern, so regex syntax doesn't count toward specificity: `^TIE(?: |\s)M` is the longer pattern but `^TIE ME UP` is the better match for "TIE ME UP".
- Patterns are written PCRE-style with a leading inline `(?i)` flag, which
JavaScript's `RegExp` won't accept; `src/lib/rules.js` lifts leading inline
flags off the pattern into `RegExp` flags.

## Structure

Merchant
- Contains generic merchant information like logo, website, colour, category, and fallback regular expressions.

Child Merchant (e.g. Store Location)
- Contains specific store location information like address, place IDs, website store URL, and regular expressions that target this store.
- Does not contain information that is already on the parent merchant, such as logo and colour.
- Not all children transaction texts contain enough information to identify them, so you may have to default to the parent without user intervention. Bespoke Letterpress, for example, uses `BESPOKE LETTERPRESS BOWRAL` on their card readers at stores in Canberra and Sydney, so there is simply no way to detect which store location those transactions came from. The Finances App includes the ability for users to manually change the merchant that a transaction references for situations like these.

## PII

I’ve replaced PII info with patterns like ABCDEF and 12345. The data that does remain is store numbers and merchant phone numbers, which sometimes appear in the transaction description.

## Submitting pull requests
- Don't include merchants that you don't want to be associated to your GitHub user account (can always submit with an anonymous account).
- Please make sure to remove PII before raising a pull request. I've included a script that identifies some, but not all, of the possible PII. Common PII is amounts, receipt numbers, ard numbers.

## Legal

### Merchant logos and icons

The icons in `merchant-icons/` are the trademarks and copyrighted works of their respective owners. I don’t own them and can’t license them to you — they are **not** covered by this repository’s data licence. They’re included solely to identify the brands they refer to (nominative use), the same way a price-comparison site or news article shows a company’s logo. Nothing here implies any merchant sponsors or endorses this project.

If you redistribute or build on this dataset, the icons are your own legal responsibility in your jurisdiction and context. If you’re a rights holder and want an icon removed or replaced, open an issue or contact me and I’ll take it down promptly.

### Licence

The dataset (the CSV files) is released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) — a public-domain dedication (see `LICENSE-DATA`). Use it for anything, including commercial products, with no conditions and no attribution required. A link back to this project is appreciated but never obligatory.

The code in this repository is licensed under the MIT licence (see `LICENSE`).

The merchant icons are excluded from both, as described above — no licence in this repository grants any rights to them.

By submitting a pull request, you agree that your contributions to the CSV files are released under CC0 1.0 and your contributions to the code under MIT.

- Steve