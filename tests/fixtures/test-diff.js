export default [{
  title: 'Test iOS Entry',
  platform: 'ios',
  lang: 'en',
  entries: [
    {
      type: 'string',
      key: 'simpleString',
      values: [{ value: 'This is iOS v2' }],
    },
  ],
}, {
  title: 'Test Android Entry',
  platform: 'android',
  lang: 'en',
  entries: [
    {
      type: 'string',
      key: 'simpleString',
      values: [{ value: 'This is Android v2' }],
    },
  ],
}, {
  title: 'Test Cross Platform Entry',
  platform: 'all',
  lang: 'en',
  entries: [
    {
      type: 'string',
      key: 'universalString',
      values: [{ value: 'This is cross platform' }],
    },
  ],
}];
