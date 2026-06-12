# Supabase - banco da gestao predial

O banco cobre:

- autenticacao pelo Supabase Auth;
- perfil individual para cada usuario;
- varios modelos por usuario;
- varias edificacoes por usuario;
- arvore hierarquica de ambientes;
- sistemas de cada modelo e edificacao;
- tipos e instancias de ativos;
- biblioteca de rotinas de manutencao;
- planos e eventos programados;
- isolamento dos dados com Row Level Security (RLS).

## Modelo validado

O usuario cria um modelo, por exemplo `Casa geminada`, contendo:

- ambientes hierarquicos do modelo;
- sistemas sugeridos do modelo.

Ao criar uma edificacao a partir desse modelo, a funcao
`create_building_from_model` copia a arvore e os sistemas. Depois da copia,
cada edificacao pode ser alterada independentemente do modelo e das demais
instancias.

## Aplicar a migracao

1. Crie um projeto no Supabase.
2. Abra o SQL Editor.
3. Execute o arquivo:
   `supabase/migrations/202606100001_foundation.sql`.
4. Execute, na sequencia:
   `supabase/migrations/202606110001_assets_maintenance.sql`.
5. Para permitir o cadastro inicial apenas com a edificacao, execute:
   `supabase/migrations/202606110002_allow_pending_assets.sql`.
6. Para adicionar a estrutura de galerias e a view `ambientes`, execute:
   `supabase/migrations/202606120001_galeria_e_ambientes.sql`.

Como alternativa, depois de instalar e vincular o Supabase CLI:

```powershell
supabase db push
```

## Criar os dois usuarios de demonstracao

Copie `.env.supabase.example` para `.env.supabase` e preencha as chaves.
Nunca publique a chave `SUPABASE_SERVICE_ROLE_KEY`.

No PowerShell:

```powershell
Get-Content .env.supabase |
  Where-Object { $_ -and -not $_.StartsWith('#') } |
  ForEach-Object {
    $name, $value = $_ -split '=', 2
    Set-Item -Path "Env:$name" -Value $value
  }

node .\scripts\create-demo-users.mjs
```

O roteiro cria:

- usuario 1, com um modelo de casa geminada e duas instancias (`CG-A` e
  `CG-B`);
- usuario 2, com seu proprio modelo e uma instancia (`CG-C`).

As credenciais administrativas sao usadas apenas nesse roteiro local. O site
recebera somente `SUPABASE_URL` e `SUPABASE_ANON_KEY`.

## Seguranca

Todas as tabelas operacionais usam RLS. Um usuario autenticado:

- enxerga e altera apenas seu perfil;
- enxerga e altera apenas seus modelos;
- enxerga e altera apenas suas edificacoes;
- acessa ambientes e sistemas somente quando a entidade pai lhe pertence.

Os tipos gerais de edificacao sao somente leitura para usuarios autenticados.

## Migrar a planilha de trabalho

A importacao preparada para `danieulenz@gmail.com` cria uma edificacao
identificada por `PLANILHA-APTO` e associa a ela:

- zonas e ambientes;
- sistemas e subsistemas;
- tipos de ativo e rotinas;
- ativos, planos e eventos do cronograma.

Depois de executar as duas migracoes SQL, rode na raiz do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-daniel-workbook.ps1
```

O processo pode ser repetido. Registros com a mesma identificacao sao
atualizados, sem duplicar ativos ou eventos.

Novos usuarios recebem a mesma estrutura vazia e podem cadastrar suas
proprias edificacoes, ambientes, sistemas, ativos e programacoes. As regras
de RLS impedem que um login consulte ou altere os dados de outro.
