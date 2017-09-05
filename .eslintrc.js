module.exports = {
  "env": {
    "es6": true,
    "node": true
  },
  "extends": "eslint:recommended",
  "parserOptions": {
    "sourceType": "module"
  },
  "rules": {
    "indent": [
            "error",
            2
        ],
    "linebreak-style": [
            "error",
            "unix"
        ],
    "semi": [
            "error",
            "always"
        ],
    "no-console": "off",
    "indent": [
      "error",
      2,
      {
        "SwitchCase": 1
      }
    ]
  }
};
