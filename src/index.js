import fs from 'fs';
import path from 'path';
import assert from 'assert';
import semver from 'semver';
import mkdirp from 'mkdirp';
import handlebars from 'handlebars';
import iosStrings from 'i18n-strings-files';

handlebars.registerHelper('maybeComment', function maybeComment(arg, options) {
  if (!arg) {
    return arg;
  }
  const data = options.data ? undefined : {
    data: handlebars.createFrame(options.data),
  };
  const string = options.fn ? options.fn(this, data) : '';
  if (!string || string.trim() === '') {
    return undefined;
  }
  const trimmed = string.trim().replace(/\n/g, ' ');
  const numSpaces = string.search(/\S/);
  return `${' '.repeat(numSpaces)}/// ${trimmed}\n`;
});

handlebars.registerHelper('oneline', function oneline(options) {
  return options.fn(this).trim().replace(/\n/g, ' ').trim();
});

export default class StringResolver {
  static IOS = 'ios';

  static ANDROID = 'android';

  constructor({ platform, version }) {
    const cleanVersion = semver.clean(version);
    assert(cleanVersion, 'Version must be a valid semver pattern');
    Object.assign(this, {
      platform,
      version: cleanVersion,
      entries: [],
    });
  }

  addEntry({ title, baseName, lang, entries }) {
    entries.forEach(({ key, values, description }) => {
      values.forEach(({ iosSemver, androidSemver, value }) => {
        const finalName = baseName ? `${baseName}${key}` : key;
        const relevantSemver = this.platform === StringResolver.IOS ? iosSemver : androidSemver;
        if (relevantSemver && !semver.satisfies(this.version, relevantSemver)) {
          return;
        }
        const existingEntry = this.entries.find(k => k.key === key) || {};
        if (!existingEntry.key) {
          existingEntry.key = finalName;
          existingEntry.values = {};
          this.entries.push(existingEntry);
        }
        if (existingEntry.values[lang]) {
          throw new Error(`Conflicting key ${finalName} in ${title} and ${existingEntry[lang].title}`);
        }
        existingEntry.values[lang] = { title, value, description };
      });
    });
  }

  writeIOSStrings(cultures, baseCulture, outputDirectory) {
    const files = {};
    cultures.forEach((culture) => {
      const stringsEntry = {};
      let lastComment;
      this.entries.forEach((entry) => {
        const cultureValue = entry.values[culture];
        const baseValue = entry.values[baseCulture];
        if (!baseValue && !cultureValue) {
          throw new Error(`${entry.key} is missing a value in the base culture`);
        }
        const comment = cultureValue?.description || baseValue.description
          || `From ${cultureValue?.title || baseValue.title}`;
        stringsEntry[entry.key] = {
          text: cultureValue?.value || baseValue?.value,
          comment: lastComment === comment ? undefined : comment,
        };
        lastComment = comment;
      });
      files[`${culture === baseCulture ? 'Base' : culture}.lproj/Localizable.strings`] = stringsEntry;
    });
    Object.keys(files).forEach((outputFile) => {
      const sortedKeys = Object.keys(files[outputFile]).map(key => ({ key, sort: key.toLocaleLowerCase() }))
        .sort((a, b) => a.sort.localeCompare(b.sort));
      const finalOrder = {};
      sortedKeys.forEach(({ key }) => { finalOrder[key] = files[outputFile][key]; });
      const output = path.join(outputDirectory, outputFile);
      mkdirp.sync(path.dirname(output));
      iosStrings.writeFileSync(output, finalOrder, { encoding: 'UTF-8', wantsComments: true });
    });
  }

  writeStringsFiles(cultures, baseCulture, outputDirectory) {
    if (this.platform === 'ios') {
      return this.writeIOSStrings(cultures, baseCulture, outputDirectory);
    }
    throw new Error('Unknown configuration');
  }

  buildClass(outputFile, baseCulture) {
    const strings = [];
    this.entries.forEach(({ key, values }) => {
      const strDetail = {
        key,
        value: values[baseCulture].value,
        isTemplate: false,
      };
      if (this.platform === StringResolver.IOS) {
        if (strDetail.value.match(/%(\d+\$)?@/)) {
          strDetail.isTemplate = true;
        }
      }
      strings.push(strDetail);
    });
    const tpath = path.join(__dirname, '..', 'src', 'templates', `${this.platform}.handlebars`);
    const t = handlebars.compile(fs.readFileSync(tpath, 'utf8'));
    const filename = path.basename(outputFile);
    const className = filename.substring(0, filename.length - path.extname(filename).length);
    const code = t({ strings, className });
    mkdirp.sync(path.dirname(outputFile));
    fs.writeFileSync(outputFile, code, 'utf8');
    return code;
  }
}
