// Independent real-language examples for #389: token spellings and public classes
// are fixed expectations, not derived from the production registry or parsers.
export interface ReadyCodeLanguageFixture {
  id: string
  label: string
  aliases: string[]
  extensions: string[]
  badge: string
  code: string
  tokens: Array<[string, string]>
}

export const READY_CODE_LANGUAGE_FIXTURES: ReadyCodeLanguageFixture[] = [
  {
    id: 'tcl', label: 'Tcl', aliases: ['tcl'], extensions: ['tcl', 'tk'], badge: 'Tcl',
    code: 'set period 10\nputs $period\n# clock',
    tokens: [['set', 'tok-keyword'], ['puts', 'tok-keyword'], ['$period', 'tok-variableName'], ['10', 'tok-number'], ['# clock', 'tok-comment']],
  },
  {
    id: 'vhdl', label: 'VHDL', aliases: ['vhdl', 'vhd'], extensions: ['vhdl', 'vhd'], badge: 'VHD',
    code: "entity counter is\nend entity;\narchitecture rtl of counter is\nbegin\n -- clock\n q <= '1';\nend architecture;",
    tokens: [['entity', 'tok-keyword'], ['architecture', 'tok-keyword'], ["'1'", 'tok-string'], ['-- clock', 'tok-comment']],
  },
  {
    id: 'toml', label: 'TOML', aliases: ['toml'], extensions: ['toml'], badge: 'TOML',
    code: '[tool.build]\nname = "chip"\nworkers = 4\n# config',
    tokens: [['[tool.build]', 'tok-atom'], ['"chip"', 'tok-string'], ['4', 'tok-number'], ['# config', 'tok-comment']],
  },
  {
    id: 'ini', label: 'INI', aliases: ['ini', 'properties'], extensions: ['ini', 'properties'], badge: 'INI',
    code: '[board]\nclock=100\n; config',
    tokens: [['[board]', 'tok-meta'], ['clock', 'tok-propertyName'], ['100', 'tok-string'], ['; config', 'tok-comment']],
  },
  {
    id: 'xml', label: 'XML', aliases: ['xml'], extensions: ['xml', 'xsd', 'xsl', 'xslt'], badge: 'XML',
    code: '<!-- board -->\n<chip name="alu">42</chip>',
    tokens: [['<!-- board -->', 'tok-comment'], ['chip', 'tok-typeName'], ['name', 'tok-propertyName'], ['"alu"', 'tok-string']],
  },
  {
    id: 'dockerfile', label: 'Dockerfile', aliases: ['dockerfile', 'docker'], extensions: ['dockerfile'], badge: 'DKR',
    code: 'FROM node:22\nENV NAME="chip"\n# build',
    tokens: [['FROM', 'tok-keyword'], ['ENV', 'tok-keyword'], ['"chip"', 'tok-string'], ['# build', 'tok-comment']],
  },
  {
    id: 'cmake', label: 'CMake', aliases: ['cmake'], extensions: ['cmake'], badge: 'CMK',
    code: 'cmake_minimum_required(VERSION 3.20)\nset(NAME "chip")\n# build',
    tokens: [['cmake_minimum_required', 'tok-definition'], ['set', 'tok-definition'], ['"chip"', 'tok-string'], ['# build', 'tok-comment']],
  },
  {
    id: 'diff', label: 'Diff', aliases: ['diff', 'patch'], extensions: ['diff', 'patch'], badge: '+−',
    code: '@@ -1 +1 @@\n-old\n+new',
    tokens: [['@@ -1 +1 @@', 'tok-meta'], ['-old', 'tok-deleted'], ['+new', 'tok-inserted']],
  },
  {
    id: "csharp",
    label: "C#",
    aliases: ["csharp", "c#", "cs"],
    extensions: ["cs"],
    badge: "C#",
    code: "using System;\nasync Task Run() { await Work(); var s = @\"C:\\chip\"; } // cs",
    tokens: [["async", "tok-keyword"], ["await", "tok-keyword"], ["@\"C:\\chip\"", "tok-string"], ["// cs", "tok-comment"]],
  },
  {
    id: "kotlin",
    label: "Kotlin",
    aliases: ["kotlin", "kt", "kts"],
    extensions: ["kt", "kts"],
    badge: "KT",
    code: "data class Chip(val width: Int = 4)\nfun run() = \"chip\" // kt",
    tokens: [["data", "tok-keyword"], ["val", "tok-keyword"], ["fun", "tok-keyword"], ["4", "tok-number"], ["\"chip\"", "tok-string"], ["// kt", "tok-comment"]],
  },
  {
    id: "swift",
    label: "Swift",
    aliases: ["swift"],
    extensions: ["swift"],
    badge: "SW",
    code: "struct Chip { let width = 4 }\nlet name = \"chip\" // swift",
    tokens: [["struct", "tok-keyword"], ["let", "tok-keyword"], ["4", "tok-number"], ["\"chip\"", "tok-string"], ["// swift", "tok-comment"]],
  },
  {
    id: "dart",
    label: "Dart",
    aliases: ["dart"],
    extensions: ["dart"],
    badge: "D",
    code: "factory Chip() => Chip._();\nfinal label = r\"chip\"; // dart",
    tokens: [["factory", "tok-keyword"], ["final", "tok-keyword"], ["r\"chip\"", "tok-string"], ["// dart", "tok-comment"]],
  },
  {
    id: "ruby",
    label: "Ruby",
    aliases: ["ruby", "rb"],
    extensions: ["rb", "rbw"],
    badge: "RB",
    code: "class Chip\n def width; 4; end\nend\nname = \"chip\" # rb",
    tokens: [["class", "tok-keyword"], ["def", "tok-keyword"], ["4", "tok-number"], ["\"chip\"", "tok-string"], ["# rb", "tok-comment"]],
  },
  {
    id: "lua",
    label: "Lua",
    aliases: ["lua"],
    extensions: ["lua"],
    badge: "Lua",
    code: "local width = 4\nfunction chip() return \"chip\" end -- lua",
    tokens: [["local", "tok-keyword"], ["4", "tok-number"], ["\"chip\"", "tok-string"], ["-- lua", "tok-comment"]],
  },
  {
    id: "r",
    label: "R",
    aliases: ["r"],
    extensions: ["r"],
    badge: "R",
    code: "if (TRUE) { x <- 4 }\nname <- \"chip\" # r",
    tokens: [["if", "tok-keyword"], ["TRUE", "tok-atom"], ["4", "tok-number"], ["\"chip\"", "tok-string"], ["# r", "tok-comment"]],
  },
  {
    id: "julia",
    label: "Julia",
    aliases: ["julia", "jl"],
    extensions: ["jl"],
    badge: "JL",
    code: "struct Chip\n width::Int64\nend\nx = 4\nname = \"chip\" # jl",
    tokens: [["struct", "tok-keyword"], ["4", "tok-number"], ["\"chip\"", "tok-string"], ["# jl", "tok-comment"]],
  },
  {
    id: "scss",
    label: "SCSS",
    aliases: ["scss"],
    extensions: ["scss"],
    badge: "SCSS",
    code: "$width: 4px;\n@mixin chip { color: \"red\"; } /* scss */",
    tokens: [["$width", "tok-definition"], ["@mixin", "tok-definition"], ["4px", "tok-number"], ["\"red\"", "tok-string"], ["/* scss */", "tok-comment"]],
  },
  {
    id: "less",
    label: "LESS",
    aliases: ["less"],
    extensions: ["less"],
    badge: "LESS",
    code: "@width: 4px;\n.chip { width: @width; content: \"red\"; } /* less */",
    tokens: [["@width", "tok-definition"], ["4px", "tok-number"], ["\"red\"", "tok-string"], ["/* less */", "tok-comment"]],
  },
  {
    id: "protobuf",
    label: "Protocol Buffers",
    aliases: ["protobuf", "proto"],
    extensions: ["proto"],
    badge: "PB",
    code: "syntax = \"proto3\";\nmessage Chip { string name = 1; } // proto",
    tokens: [["syntax", "tok-keyword"], ["message", "tok-keyword"], ["1", "tok-number"], ["\"proto3\"", "tok-string"], ["// proto", "tok-comment"]],
  },
]
