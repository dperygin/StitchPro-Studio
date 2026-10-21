// Bundled font lists (SIL OFL fonts from @fontsource).

export interface BundledFont {
  family: string;
  pkg: string;
}

export const bundledFonts: BundledFont[] = [
  { family: 'Roboto', pkg: '@fontsource/roboto' },
  { family: 'Oswald', pkg: '@fontsource/oswald' },
  { family: 'Pacifico', pkg: '@fontsource/pacifico' },
];
