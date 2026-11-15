// Titles and one-line summaries for programs in examples/.
// Keep summaries factual: describe what the program does and which check it exercises.
// Entries missing here still appear in the Lab with a title derived from the file name.

export const CATEGORY_LABELS = {
  language: 'Linguagem',
  heap: 'Heap',
  'control-flow': 'Controle de fluxo',
  containers: 'Containers e referências',
  std: 'Biblioteca padrão',
  imports: 'Módulos',
  env: 'Ambiente',
  language_foundations: 'Linguagem',
  ffi: 'FFI',
  ownership: 'Ownership',
  async: 'Async',
  protocols: 'Protocolos',
};

export const EXAMPLE_META = {
  'connection.isa': { featured: true, title: 'Protocolo de conexão',
    summary: 'Typestate com três estados. Cada método só é aceito no estado em que o protocolo o declara.' },
  'string_move_invalid.isa': { featured: true, title: 'Uso após move',
    summary: 'String usada depois de ser movida. O checker rejeita o programa com E0301 antes de gerar código.' },
  'heap/buffer.isa': { featured: true, title: 'Buffer com release',
    summary: 'release() libera a alocação e leva o valor ao estado final Released; o drop seguinte não libera de novo.' },
  'heap/borrowing.isa': { featured: true, title: 'Empréstimos lexicais',
    summary: 'Blocos borrow shared e borrow unique sobre um BoxI32, sem cópia e sem nova alocação.' },
  'control-flow/showcase.isa': { featured: true, title: 'Enums, match e loops',
    summary: 'Enum com payload, match exaustivo, for em range, while com continue e loop com break.' },
  'containers/generic_storage.isa': { featured: true, title: 'Vec<Box<String>>',
    summary: 'Containers genéricos owned com move de elementos e drop recursivo verificado.' },
  'async_local.isa': { featured: true, title: 'async/await local',
    summary: 'Funções async encadeadas executadas como máquinas de estado, com String movida pelo future.' },
  'macros_demo.isa': { featured: true, title: 'Macros e formatação',
    summary: 'Macros declaradas com @macro, captura de expressões e @format/@println.' },
  'language_foundations/foundations.isa': { featured: true, title: 'Arrays e operações de bits',
    summary: 'Constantes, arrays de tamanho fixo em structs, slices mutáveis, casts e deslocamentos.' },
  'string_demo.isa': { title: 'String UTF-8' },
  'string_move.isa': { title: 'Move de String' },
  'string_positions.isa': { title: 'Posições em UTF-8',
    summary: 'char_at e find_from trabalham com offsets em bytes e retornam Option.' },
  'file.isa': { title: 'Protocolo de arquivo' },
  'expressions.isa': { title: 'Constantes e match como expressão' },
  'input_demo.isa': { title: 'Leitura de stdin',
    summary: '@input lê uma linha e @input<i32> faz o parsing; os erros chegam como resultado, não como exceção.' },
  'scoped_worker.isa': { title: 'Laço for estilo C' },
  'async_borrow_reconstruction.isa': { title: 'Empréstimos através de await',
    summary: 'Referências vivas atravessam pontos de await e são reconstruídas no frame do future.' },
  'async_threaded.isa': { title: '@thread com async' },
  'thread_owned.isa': { title: 'Thread com valor owned' },
  'thread_carriers.isa': { title: 'Carriers entre threads' },
  'protocol_execution.isa': { title: 'Protocolo em thread e future' },
  'heap/box.isa': { title: 'BoxI32 e move' },
  'control-flow/commands.isa': { title: 'Comandos com enum' },
  'control-flow/heap-loops.isa': { title: 'Heap dentro de loops' },
  'control-flow/iteration.isa': { title: 'Iteração e views de matriz' },
  'control-flow/optimization.isa': { title: 'Programa para -O2' },
  'env/arguments.isa': { title: 'Argumentos de linha de comando' },
  'std/collections.isa': { title: 'Coleções da std' },
  'std/owned_collections.isa': { title: 'Coleções com elementos owned' },
  'std/systems.isa': { title: 'env, path e time' },
  'imports/main.isa': { title: 'Imports locais' },
  'imports/isolated/main.isa': { title: 'Imports com alias' },
  'ffi/advanced.isa': { title: 'FFI: callbacks e unions' },
  'ffi/record.isa': { title: 'FFI: structs C' },
  'ffi/sequences.isa': { title: 'FFI: slices e texto' },
  // Programs written for the Lab, covering the topics of the FFI and @thread
  // examples without the features the WebAssembly build lacks.
  'ownership/vec_transfer.isa': { title: 'Vec e String por valor e por empréstimo',
    summary: 'Vec<i32> movido para uma função e devolvido, String editada por &mut e array lido como slice.' },
  'ownership/borrowed_record.isa': { title: 'Struct com referências',
    summary: 'Struct com um campo &i32, um &mut i32 e uma String owned; os empréstimos terminam quando execute retorna.' },
  'async/borrowed_append.isa': { title: 'Empréstimo antes de await',
    summary: 'A String é emprestada como &mut antes do await e continua owned por main.' },
  'protocols/work_token.isa': { title: 'Protocolo em função async',
    summary: 'O mesmo protocolo usado em uma função comum e em uma função async executada com @block_on.' },
  'containers/sequences.isa': { title: 'Arrays, slices e String emprestados' },
  'language_foundations/records.isa': { title: 'Structs aninhadas, @size_of e @align_of' },
  'control-flow/numbers.isa': { title: 'Enum com payloads numéricos' },
};

// Diagnostics caused by what the WebAssembly build of isac does not include.
export const UNSUPPORTED = {
  E7001: 'Não funciona no laboratório: a ponte ABI C da FFI é compilada pelo Clang, que a build WebAssembly não inclui.',
  E8006: 'Não funciona no laboratório: a build WebAssembly não tem allocator entre threads, e o checker recusa a transferência para @thread.',
};

// Shown on the Lab and on the home page. Keep in sync with the WebAssembly build.
export const LAB_NOT_WORKING = [
  { what: 'FFI com ponte ABI C', why: 'A ponte é compilada pelo Clang, ausente na build (`E7001`). `--emit-c-bridge` ainda mostra o código C gerado.' },
  { what: '`@thread` com valores owned ou referências', why: 'A build não tem allocator entre threads; o checker recusa a transferência (`E8006`).' },
  { what: '`--sanitize`', why: 'ASan e UBSan dependem da ligação nativa com Clang.' },
  { what: 'Entrada interativa', why: 'O programa não pausa esperando o teclado: o texto é digitado na caixa “Entrada do programa”, abaixo do terminal, antes de executar.' },
];
