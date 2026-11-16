#!/usr/bin/env python3
"""Génère le DDL des bases sources de test (MDE : SQL Server, OPTIM : MariaDB) à partir des catalogues des analyses.

Usage : python3 -I tests/reprise/generer-ddl.py mde <ANALYSE-MDE_DOS_DEV.md> tests/reprise/mde/schema.sql
        python3 -I tests/reprise/generer-ddl.py optim <ANALYSE-OPTIMBTP-MARIADB.md> tests/reprise/optim/schema.sql

Choix (bases de test, lecture seule par l'import) :
- ni clé étrangère (l'import ne doit pas les supposer : OPTIM n'en a pas), ni identité / auto-incrément (les jeux de
  données donnent leurs identifiants) ; clé primaire conservée ;
- une colonne NOT NULL hors clé primaire reçoit un défaut neutre (0, '', date du 01/01/1900) pour que les jeux de données
  restent courts ; les colonnes timestamp (rowversion) de SQL Server sont générées par le moteur.
"""
import re
import sys

DEBUT = {'mde': '## 7. Catalogue', 'optim': '## 9. Catalogue'}


def lire(chemin, source):
    texte = open(chemin, encoding='utf-8').read()
    texte = texte[texte.index(DEBUT[source]):]
    tables, cur = [], None
    for i, ligne in enumerate(texte.split('\n')):
        if i > 0 and ligne.startswith('## '):
            break  # fin du catalogue
        m = re.match(r'^#### `([^`]+)`', ligne)
        if m:
            cur = {'nom': m.group(1), 'cols': [], 'pk': []}
            tables.append(cur)
            continue
        if cur is None:
            continue
        m = re.match(r'^- \*\*Clé primaire\*\* : (.*)$', ligne)
        if m:
            cur['pk'] = re.findall(r'`([^`]+)`', m.group(1))
            continue
        m = re.match(r'^\| ([^|]+) \| ([^|]+) \| ([^|]*) \| ([^|]*) \|$', ligne)
        if m and m.group(1).strip() not in ('Colonne',) and not m.group(1).startswith('---'):
            nom, typ, nul = m.group(1).strip(), m.group(2).strip(), m.group(3).strip()
            if typ.startswith('---') or typ == 'Type':
                continue
            cur['cols'].append((nom, typ, nul == 'oui'))
    return [t for t in tables if t['cols']]


def defaut(typ):
    t = typ.lower()
    if t.startswith(('varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext', 'mediumtext', 'longtext', 'tinytext')):
        return "''"
    if t.startswith(('datetime', 'date', 'smalldatetime')):
        return "'1900-01-01'"
    if t.startswith(('timestamp', 'rowversion', 'varbinary', 'binary', 'image', 'blob', 'longblob', 'mediumblob')):
        return None
    if t.startswith('time'):
        return "'00:00:00'"
    if t.startswith('uniqueidentifier'):
        return "'00000000-0000-0000-0000-000000000000'"
    return '0'


def ddl_mde(tables):
    sortie = []
    for t in tables:
        lignes = []
        for nom, typ, nul in t['cols']:
            d = '' if nul or nom in t['pk'] or defaut(typ) is None else f' DEFAULT {defaut(typ)}'
            lignes.append(f'    [{nom}] {typ} {"NULL" if nul else "NOT NULL"}{d}')
        if t['pk']:
            lignes.append('    PRIMARY KEY (' + ', '.join(f'[{c}]' for c in t['pk']) + ')')
        sortie.append(f'CREATE TABLE dbo.[{t["nom"]}] (\n' + ',\n'.join(lignes) + '\n);\nGO\n')
    return sortie


def ddl_optim(tables):
    sortie = []
    for t in tables:
        lignes = []
        for nom, typ, nul in t['cols']:
            d = '' if nul or nom in t['pk'] or defaut(typ) is None else f' DEFAULT {defaut(typ)}'
            lignes.append(f'    `{nom}` {typ} {"NULL" if nul else "NOT NULL"}{d}')
        if t['pk']:
            lignes.append('    PRIMARY KEY (' + ', '.join(f'`{c}`' for c in t['pk']) + ')')
        sortie.append(f'CREATE TABLE `{t["nom"]}` (\n' + ',\n'.join(lignes) + '\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n')
    return sortie


def main():
    source, catalogue, cible = sys.argv[1], sys.argv[2], sys.argv[3]
    tables = lire(catalogue, source)
    entete = ('-- Généré par tests/reprise/generer-ddl.py depuis le catalogue de l\'analyse de la base source : ne pas éditer.\n'
              f'-- {len(tables)} tables ; ni clé étrangère ni identité (voir le générateur).\n')
    corps = ddl_mde(tables) if source == 'mde' else ddl_optim(tables)
    with open(cible, 'w', encoding='utf-8', newline='\n') as f:
        f.write(entete + '\n' + '\n'.join(corps))
    print(f'{cible} : {len(tables)} tables')


if __name__ == '__main__':
    main()
