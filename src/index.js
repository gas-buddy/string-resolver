import fs from 'fs';
import path from 'path';
import assert from 'assert';
import semver from 'semver';
import mkdirp from 'mkdirp';
import handlebars from 'handlebars';
import iosStrings from 'i18n-strings-files';
import deepEqual from 'deep-equal';

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

function buildStringsByKey(entryArray) {
  const byKey = {};
  entryArray.forEach(({ baseName, lang, platform, entries }) => {
    entries.forEach(({ key, values, type }) => {
      values.forEach((valueEntry) => {
        const { iosSemver, androidSemver, value } = valueEntry;
        const finalName = baseName ? `${baseName}${key}` : key;
        if (!byKey[finalName]) {
          byKey[finalName] = {};
        }
        const keyInfo = byKey[finalName];
        if (!keyInfo[platform]) {
          keyInfo[platform] = {};
        }
        const platInfo = keyInfo[platform];
        if (!platInfo[lang]) {
          platInfo[lang] = {};
        }
        const platLang = platInfo[lang];
        if (!platLang[type]) {
          platLang[type] = [];
        }
        const finalValues = platLang[type];
        finalValues.push({ iosSemver, androidSemver, value });
      });
    });
  });
  return byKey;
}

function addDiffDetails(resolver, key, details) {
  if (!details) {
    return;
  }
  for (const [platform, languages] of Object.entries(details)) {
    for (const [language, types] of Object.entries(languages)) {
      for (const [type, values] of Object.entries(types)) {
        const virtualEntry = {
          title: 'Diff',
          lang: language,
          platform,
          entries: [{
            key,
            values,
            type,
          }],
        };
        resolver.addEntry(virtualEntry);
      }
    }
  }
}

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
          if (title === existingEntry.values[lang].title) {
            throw new Error(`Key ${finalName} appears twice in ${title}`);
          }
          throw new Error(`Conflicting key ${finalName} in ${title} and ${existingEntry.values[lang].title}`);
        }
        if (type === 'plural') {
          existingEntry.values[lang] = { title, values: valueEntry, description };
        } else {
          existingEntry.values[lang] = { title, value, description };
        }
      });
    });
  }

  getAllValuesForString(key) {
    const entry = this.entries.find(str => str.key === key);
    if (!entry) {
      return null;
    }
    return Object.entries(entry.values)
      .reduce((agg, [culture, { value }]) => {
        agg[culture] = value;
        return agg;
      }, {});
  }

  writeIOSStrings(cultures, baseCulture, outputDirectory) {
    const files = {};
    let baseCultureFile;
    cultures.forEach((culture) => {
      const stringsEntry = {};
      this.entries.forEach((entry) => {
        const cultureValue = entry.values[culture];
        const baseValue = entry.values[baseCulture];
        if (!baseValue && !cultureValue) {
          throw new Error(`${entry.key} is missing a value in the base culture`);
        }

        const comment = cultureValue?.description || baseValue.description;
        const genComment = `From ${cultureValue?.title || baseValue.title}`;

        stringsEntry[entry.key] = {
          text: cultureValue?.value || baseValue?.value,
          comment,
          genComment,
        };
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
      let lastGeneratedComment;
      sortedKeys.forEach(({ key }) => {
        const { text, comment, genComment } = files[outputFile][key];
        let finalComment;
        if (comment && genComment !== lastGeneratedComment) {
          finalComment = `${genComment} - ${comment}`;
        } else if (comment) {
          finalComment = comment;
        } else if (genComment !== lastGeneratedComment) {
          finalComment = genComment;
        }
        finalOrder[key] = { text, comment: finalComment };
        lastGeneratedComment = genComment;
      });
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

  /**
   * Compute the keys that have changed (and some details) in some way between baseEntries and targetEntries.
   */
  static changeDetail(baseEntries, targetEntries) {
    const beforeGrouped = buildStringsByKey(baseEntries);
    const afterGrouped = buildStringsByKey(targetEntries);
    const changeDetails = {};
    Object.keys(afterGrouped).forEach((afterKey) => {
      if (!deepEqual(afterGrouped[afterKey], beforeGrouped[afterKey])) {
        changeDetails[afterKey] = {
          before: beforeGrouped[afterKey] || null,
          after: afterGrouped[afterKey],
        };
      }
    });
    // TODO perhaps look for strings that were removed from the target
    return changeDetails;
  }

  static computeChanges(changeDetails, platform, version) {
    const before = new StringResolver({ platform, version });
    const after = new StringResolver({ platform, version });
    const diff = [];
    Object.entries(changeDetails).forEach(([stringKey, detail]) => {
      addDiffDetails(before, stringKey, detail.before);
      addDiffDetails(after, stringKey, detail.after);
      const oldValue = before.getAllValuesForString(stringKey);
      const newValue = after.getAllValuesForString(stringKey);
      if (!deepEqual(oldValue, newValue)) {
        diff.push({ key: stringKey, value: newValue });
      }
    });
    return diff.reduce((agg, { key, value }) => {
      agg[key] = value;
      return agg;
    }, {});
  }
}
