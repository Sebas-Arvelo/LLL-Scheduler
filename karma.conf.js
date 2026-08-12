module.exports = (config) => {
  config.set({
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
      require('@angular-devkit/build-angular/plugins/karma'),
    ],
    reporters: ['progress', 'kjhtml'],
    browsers: ['ChromeHeadlessConfigured'],
    customLaunchers: {
      ChromeHeadlessConfigured: {
        base: 'ChromeHeadless',
        flags: ['--disable-gpu', '--no-sandbox'],
      },
    },
    restartOnFileChange: true,
  });
};
