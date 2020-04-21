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

handlebars.registerHelper('oneline', options => options.fn(this).trim().replace(/\n/g, ' ').trim());
handlebars.registerHelper('escape', variable => variable.replace(/(['"])/g, '\\$1'));

export default class StringResolver {
  static IOS = 'ios';

  static ANDROID = 'android';

  constructor({ platform, version, sourceId }) {
    const cleanVersion = semver.clean(version);
    assert(cleanVersion, 'Version must be a valid semver pattern');
    Object.assign(this, {
      platform,
      version: cleanVersion,
      sourceId,
      entries: [],
    });
  }

  addEntry({ title, baseName, lang, platform, entries }) {
    if (platform && platform !== 'all' && platform !== this.platform) {
      return;
    }
    entries.forEach(({ key, values, type, description, doNotTranslate }) => {
      values.forEach((valueEntry) => {
        const { iosSemver, androidSemver, value } = valueEntry;
        const finalName = baseName ? `${baseName}${key}` : key;
        const relevantSemver = this.platform === StringResolver.IOS ? iosSemver : androidSemver;
        if (relevantSemver && !semver.satisfies(this.version, relevantSemver)) {
          return;
        }
        const existingEntry = this.entries.find(k => k.key === key) || {};
        if (!existingEntry.key) {
          existingEntry.key = finalName;
          existingEntry.type = type;
          existingEntry.values = {};
          existingEntry.doNotTranslate = doNotTranslate;
          this.entries.push(existingEntry);
        }
        if (existingEntry.values[lang]) {
          throw new Error(`Conflicting key ${finalName} in ${title} and ${existingEntry[lang].title}`);
        }
        if (type === 'plural') {
          existingEntry.values[lang] = { title, values: valueEntry, description };
        } else {
          existingEntry.values[lang] = { title, value, description };
        }
      });
    });
  }

  writeIOSStrings(cultures, baseCulture, outputDirectory) {
    const files = {};
    let baseCultureFile;
    cultures.forEach((culture) => {
      const stringsEntry = {};
      let lastGeneratedComment;
      this.entries.forEach((entry) => {
        const cultureValue = entry.values[culture];
        const baseValue = entry.values[baseCulture];
        if (!baseValue && !cultureValue) {
          throw new Error(`${entry.key} is missing a value in the base culture`);
        }

        const comment = cultureValue?.description || baseValue.description;
        const genComment = `From ${cultureValue?.title || baseValue.title}`;

        let finalComment;
        if (comment && genComment !== lastGeneratedComment) {
          finalComment = `${genComment} - ${comment}`;
        } else if (genComment !== lastGeneratedComment) {
          finalComment = genComment;
        }
        stringsEntry[entry.key] = {
          text: cultureValue?.value || baseValue?.value,
          comment: finalComment,
        };
        lastGeneratedComment = genComment;
      });
      if (culture === baseCulture) {
        baseCultureFile = stringsEntry;
      }
      files[`${culture === baseCulture ? 'Base' : culture}.lproj/Localizable.strings`] = stringsEntry;
    });
    Object.keys(files).forEach((outputFile) => {
      const sortedKeys = Object.keys(files[outputFile]).map(key => ({ key, sort: key.toLocaleLowerCase() }))
        .sort((a, b) => a.sort.localeCompare(b.sort));
      const finalOrder = {};
      if (files[outputFile] === baseCultureFile) {
        // eslint-disable-next-line no-underscore-dangle
        finalOrder.__localizedStringSourceId__ = this.sourceId;
      }
      sortedKeys.forEach(({ key }) => { finalOrder[key] = files[outputFile][key]; });
      const output = path.join(outputDirectory, outputFile);
      mkdirp.sync(path.dirname(output));
      iosStrings.writeFileSync(output, finalOrder, { encoding: 'UTF-8', wantsComments: true });
    });
  }

  writeAndroidStrings(cultures, baseCulture, outputDirectory) {
    const tpath = path.join(__dirname, '..', 'src', 'templates', 'android-strings.handlebars');
    const t = handlebars.compile(fs.readFileSync(tpath, 'utf8'));
    cultures.forEach((culture) => {
      // TODO there are weird precedence rules in Android. Account for them.
      const entries = [];
      [...this.entries]
        .sort((a, b) => a.key.localeCompare(b.key))
        .forEach(({ key, type, doNotTranslate, values }) => {
          if (!values[culture]) {
            return;
          }
          const strDetail = {
            key,
            type,
            doNotTranslate,
            isPlural: type === 'plural',
            value: values[culture].value,
            values: values[culture].values,
          };
          entries.push(strDetail);
        });
      if (culture === baseCulture) {
        // eslint-disable-next-line no-underscore-dangle
        entries.unshift({
          key: '__localizedStringSourceId__',
          type: 'string',
          doNotTranslate: true,
          value: this.sourceId,
        });
      }
      const strings = t({ entries });
      const [lang, region] = culture.split('-');
      let filename = region ? `values-${lang}-r${region.toUpperCase()}` : `values-${lang}`;
      if (culture === baseCulture) {
        filename = 'values';
      }
      fs.writeFileSync(path.join(outputDirectory, filename, 'strings.xml'), strings, 'utf8');
    });
  }

  writeStringsFiles(cultures, baseCulture, outputDirectory) {
    if (this.platform === 'ios') {
      return this.writeIOSStrings(cultures, baseCulture, outputDirectory);
    }
    return this.writeAndroidStrings(cultures, baseCulture, outputDirectory);
  }

  writeCode(outputFile, baseCulture) {
    const strings = [];
    [...this.entries]
      .sort((a, b) => a.key.localeCompare(b.key))
      .forEach(({ key, values }) => {
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
