import * as path from 'path';

import {
  PackageName,
  FileSystem,
  NewlineKind
} from '@rushstack/node-core-library';
import {
  DocComment,
  DocNodeKind,
  DocParagraph,
  DocNode,
  DocPlainText,
  DocCodeSpan,
  DocLinkTag
} from '@microsoft/tsdoc';
import {
  ApiModel,
  ApiItem,
  ApiEnum,
  ApiPackage,
  ApiItemKind,
  ApiReleaseTagMixin,
  ApiDocumentedItem,
  ApiClass,
  ReleaseTag,
  ApiStaticMixin,
  ApiPropertyItem,
  ApiInterface,
//  Excerpt,
  ApiParameterListMixin,
//  ApiReturnTypeMixin,
  ApiDeclaredItem,
  ApiNamespace
} from '@microsoft/api-extractor-model';

import { Utilities } from '../utils/Utilities';
import { PluginLoader } from '../plugin/PluginLoader';
import {
  MarkdownDocumenterFeatureContext
} from '../plugin/MarkdownDocumenterFeature';
import { DocumenterConfig } from './DocumenterConfig';
import { MarkdownDocumenterAccessor } from '../plugin/MarkdownDocumenterAccessor';
import {
  HtmlNode,
  emit,
  tag,
  table,
  tr,
  a,
} from '../html/HtmlEmitter';

/**
 * Renders API documentation in HTML format.
 */
export class HtmlDocumenter {
  private readonly _apiModel: ApiModel;
  private readonly _documenterConfig: DocumenterConfig | undefined;
  private _outputFolder: string;
  private readonly _pluginLoader: PluginLoader;

  public constructor(apiModel: ApiModel, documenterConfig: DocumenterConfig | undefined) {
    this._apiModel = apiModel;
    this._documenterConfig = documenterConfig;

    this._pluginLoader = new PluginLoader();
  }

  public generateFiles(outputFolder: string): void {
    this._outputFolder = outputFolder;

    if (this._documenterConfig) {
      this._pluginLoader.load(this._documenterConfig, () => {
        return new MarkdownDocumenterFeatureContext({
          apiModel: this._apiModel,
          outputFolder: outputFolder,
          documenter: new MarkdownDocumenterAccessor({
            getLinkForApiItem: (apiItem: ApiItem) => {
              return this._getLinkFilenameForApiItem(apiItem);
            }
          })
        });
      });
    }

    console.log();
    this._deleteOldOutputFiles();

    FileSystem.copyFile({
      sourcePath: require.resolve('../html/styles.css'),
      destinationPath: path.join(outputFolder, 'styles.css'),
    });

    this._writeApiItemPage(this._apiModel);

    if (this._pluginLoader.markdownDocumenterFeature) {
      this._pluginLoader.markdownDocumenterFeature.onFinished({ });
    }
  }

  private _writeApiItemPage(apiItem: ApiItem): void {
    const output: HtmlNode[] = [];

    this._writeBreadcrumb(output, apiItem);

    const scopedName: string = apiItem.getScopedNameWithinPackage();

    switch (apiItem.kind) {
      case ApiItemKind.Class:
        output.push(tag('h1', 'page-header', `${scopedName} class`));
        break;
      case ApiItemKind.Enum:
        output.push(tag('h1', 'page-header', `${scopedName} enum`));
        break;
      case ApiItemKind.Interface:
        output.push(tag('h1', 'page-header', `${scopedName} interface`));
        break;
      case ApiItemKind.Constructor:
      case ApiItemKind.ConstructSignature:
        output.push(tag('h1', 'page-header', `${scopedName}`));
        break;
      case ApiItemKind.Method:
      case ApiItemKind.MethodSignature:
        output.push(tag('h1', 'page-header', `${scopedName} method`));
        break;
      case ApiItemKind.Function:
        output.push(tag('h1', 'page-header', `${scopedName} function`));
        break;
      case ApiItemKind.Model:
        output.push(tag('h1', 'page-header', `${scopedName} API Reference`));
        break;
      case ApiItemKind.Namespace:
        output.push(tag('h1', 'page-header', `${scopedName} namespace`));
        break;
      case ApiItemKind.Package:
        console.log(`Writing ${apiItem.displayName} package`);
        const unscopedPackageName: string = PackageName.getUnscopedName(apiItem.displayName);
        output.push(tag('h1', 'page-header', `${unscopedPackageName} package`));
        break;
      case ApiItemKind.Property:
      case ApiItemKind.PropertySignature:
        output.push(tag('h1', 'page-header', `${scopedName} property`));
        break;
      case ApiItemKind.TypeAlias:
        output.push(tag('h1', 'page-header', `${scopedName} type`));
        break;
      case ApiItemKind.Variable:
        output.push(tag('h1', 'page-header', `${scopedName} variable`));
        break;
      default:
        throw new Error('Unsupported API item kind: ' + apiItem.kind);
    }

    if (ApiReleaseTagMixin.isBaseClassOf(apiItem)) {
      if (apiItem.releaseTag === ReleaseTag.Beta)  {
        this._writeBetaWarning(output);
      }
    }

    if (apiItem instanceof ApiDocumentedItem) {
      const tsdocComment: DocComment | undefined = apiItem.tsdocComment;

      if (tsdocComment) {

/*
        if (tsdocComment.deprecatedBlock) {
          output.push(
            new DocNoteBox({ configuration: this._tsdocConfiguration },
              [
                new DocParagraph({ configuration: this._tsdocConfiguration }, [
                  new DocPlainText({
                    configuration: this._tsdocConfiguration,
                    text: 'Warning: This API is now obsolete. '
                  })
                ]),
                ...tsdocComment.deprecatedBlock.content.nodes
              ]
            )
          );
        }
*/

        output.push(tag('div', 'summary', this._createDocNodes(tsdocComment.summarySection.nodes)));
      }
    }

    if (apiItem instanceof ApiDeclaredItem) {
      if (apiItem.excerpt.text.length > 0) {
        output.push(tag('div', 'signature-heading', 'Signature'));
        output.push(tag('pre', 'signature', apiItem.getExcerptWithModifiers()));
      }
    }

    let appendRemarks: boolean = true;
    switch (apiItem.kind) {
      case ApiItemKind.Class:
      case ApiItemKind.Interface:
      case ApiItemKind.Namespace:
      case ApiItemKind.Package:
        this._writeRemarksSection(output, apiItem);
        appendRemarks = false;
        break;
    }

    switch (apiItem.kind) {
      case ApiItemKind.Class:
        this._writeClassTables(output, apiItem as ApiClass);
        break;
      case ApiItemKind.Enum:
        this._writeEnumTables(output, apiItem as ApiEnum);
        break;
      case ApiItemKind.Interface:
        this._writeInterfaceTables(output, apiItem as ApiInterface);
        break;
      case ApiItemKind.Constructor:
      case ApiItemKind.ConstructSignature:
      case ApiItemKind.Method:
      case ApiItemKind.MethodSignature:
      case ApiItemKind.Function:
        this._writeParameterTables(output, apiItem as ApiParameterListMixin);
        this._writeThrowsSection(output, apiItem);
        break;
      case ApiItemKind.Namespace:
        this._writePackageOrNamespaceTables(output, apiItem as ApiNamespace);
        break;
      case ApiItemKind.Model:
        this._writeModelTable(output, apiItem as ApiModel);
        break;
      case ApiItemKind.Package:
        this._writePackageOrNamespaceTables(output, apiItem as ApiPackage);
        break;
      case ApiItemKind.Property:
      case ApiItemKind.PropertySignature:
        break;
      case ApiItemKind.TypeAlias:
        break;
      case ApiItemKind.Variable:
        break;
      default:
        throw new Error('Unsupported API item kind: ' + apiItem.kind);
    }

    if (appendRemarks) {
      this._writeRemarksSection(output, apiItem);
    }

    const filename: string = path.join(this._outputFolder, this._getFilenameForApiItem(apiItem));
    let pageContent = emit([ 'styles.css' ], [
      tag('header', [
        tag('div', 'header-top', [
          a('', 'https://developers.symphony.com/', 'header-logo')
        ]),
        tag('div', 'header-bottom', [])
      ]),
      tag('div', 'main', output)
    ]);

    FileSystem.writeFile(filename, pageContent, {
      convertLineEndings: this._documenterConfig ? this._documenterConfig.newlineKind : NewlineKind.CrLf
    });
  }

  private _writeRemarksSection(output: HtmlNode[], apiItem: ApiItem): void {
    if (apiItem instanceof ApiDocumentedItem) {
      const tsdocComment: DocComment | undefined = apiItem.tsdocComment;

      if (tsdocComment) {
        // Write the @remarks block
        if (tsdocComment.remarksBlock) {
          output.push(tag('div', 'remarks', 'Remarks'));
          output.push(tag('div', this._createDocNodes(tsdocComment.remarksBlock.content.nodes)));
        }

/*
        // Write the @example blocks
        const exampleBlocks: DocBlock[] = tsdocComment.customBlocks.filter(x => x.blockTag.tagNameWithUpperCase
          === StandardTags.example.tagNameWithUpperCase);

        let exampleNumber: number = 1;
        for (const exampleBlock of exampleBlocks) {
          const heading: string = exampleBlocks.length > 1 ? `Example ${exampleNumber}` : 'Example';

          output.push(new DocHeading({ configuration: this._tsdocConfiguration, title: heading }));

          this._appendSection(output, exampleBlock.content);

          ++exampleNumber;
        }
*/
      }
    }
  }

  private _writeThrowsSection(output: HtmlNode[], apiItem: ApiItem): void {
    if (apiItem instanceof ApiDocumentedItem) {
      const tsdocComment: DocComment | undefined = apiItem.tsdocComment;

      if (tsdocComment) {
/*
        // Write the @throws blocks
        const throwsBlocks: DocBlock[] = tsdocComment.customBlocks.filter(x => x.blockTag.tagNameWithUpperCase
          === StandardTags.throws.tagNameWithUpperCase);

          if (throwsBlocks.length > 0) {
          const heading: string = 'Exceptions';
          output.push(new DocHeading({ configuration: this._tsdocConfiguration, title: heading }));

          for (const throwsBlock of throwsBlocks) {
            this._appendSection(output, throwsBlock.content);
          }
        }
*/
      }
    }
  }

  /**
   * GENERATE PAGE: MODEL
   */
  private _writeModelTable(output: HtmlNode[], apiModel: ApiModel): void {
    const packagesTable = table([ 'Package', 'Description' ]);

    for (const apiMember of apiModel.members) {
      const row = tr([ this._createTitleCell(apiMember), this._createDescriptionCell(apiMember) ]);

      switch (apiMember.kind) {
        case ApiItemKind.Package:
          packagesTable.content.push(row);
          this._writeApiItemPage(apiMember);
          break;
      }
    }

    if (packagesTable.content.length > 0) {
      output.push(tag('h3', 'section-heading', 'Packages'));
      output.push(packagesTable);
    }
  }

  /**
   * GENERATE PAGE: PACKAGE or NAMESPACE
   */
  private _writePackageOrNamespaceTables(output: HtmlNode[], apiContainer: ApiPackage | ApiNamespace): void {
    const classesTable = table([ 'Class', 'Description' ]);
    const enumerationsTable = table([ 'Enumeration', 'Description' ]);
    const functionsTable = table([ 'Function', 'Description' ]);
    const interfacesTable =table([ 'Interface', 'Description' ]);
    const namespacesTable = table([ 'Namespace', 'Description' ]);
    const variablesTable= table([ 'Variable', 'Description' ]);
    const typeAliasesTable = table([ 'Type Alias', 'Description' ]);

    const apiMembers: ReadonlyArray<ApiItem> = apiContainer.kind === ApiItemKind.Package ?
      (apiContainer as ApiPackage).entryPoints[0].members
      : (apiContainer as ApiNamespace).members;

    for (const apiMember of apiMembers) {

      const row = tr([
        this._createTitleCell(apiMember),
        this._createDescriptionCell(apiMember)
      ]);

      switch (apiMember.kind) {
        case ApiItemKind.Class:
          classesTable.content.push(row);
          this._writeApiItemPage(apiMember);
          break;

        case ApiItemKind.Enum:
          enumerationsTable.content.push(row);
          this._writeApiItemPage(apiMember);
          break;

        case ApiItemKind.Interface:
          interfacesTable.content.push(row);
          this._writeApiItemPage(apiMember);
          break;

        case ApiItemKind.Namespace:
          namespacesTable.content.push(row);
          this._writeApiItemPage(apiMember);
          break;

        case ApiItemKind.Function:
          functionsTable.content.push(row);
          this._writeApiItemPage(apiMember);
          break;

        case ApiItemKind.TypeAlias:
          typeAliasesTable.content.push(row);
          this._writeApiItemPage(apiMember);
          break;

        case ApiItemKind.Variable:
          variablesTable.content.push(row);
          this._writeApiItemPage(apiMember);
          break;
      }
    }

    if (classesTable.content.length > 1) {
      output.push(tag('h3', 'section-heading', 'Classes'));
      output.push(classesTable);
    }

    if (enumerationsTable.content.length > 1) {
      output.push(tag('h3', 'section-heading', 'Enumerations'));
      output.push(enumerationsTable);
    }
    if (functionsTable.content.length > 1) {
      output.push(tag('h3', 'section-heading', 'Functions'));
      output.push(functionsTable);
    }

    if (interfacesTable.content.length > 1) {
      output.push(tag('h3', 'section-heading', 'Interfaces'));
      output.push(interfacesTable);
    }

    if (namespacesTable.content.length > 1) {
      output.push(tag('h3', 'section-heading', 'Namespaces'));
      output.push(namespacesTable);
    }

    if (variablesTable.content.length > 1) {
      output.push(tag('h3', 'section-heading', 'Variables'));
      output.push(variablesTable);
    }

    if (typeAliasesTable.content.length > 1) {
      output.push(tag('h3', 'section-heading', 'Types'));
      output.push(typeAliasesTable);
    }
  }

  /**
   * GENERATE PAGE: CLASS
   */
  private _writeClassTables(output: HtmlNode[], apiClass: ApiClass): void {
    const eventsTable = table([ 'Property', 'Modifiers', 'Type', 'Description' ]);
    const constructorsTable = table([ 'Constructor', 'Modifiers', 'Description' ]);
    const propertiesTable = table([ 'Property', 'Modifiers', 'Type', 'Description' ]);
    const methodsTable = table([ 'Method', 'Modifiers', 'Description' ]);

    for (const apiMember of apiClass.members) {

      switch (apiMember.kind) {
        case ApiItemKind.Constructor: {
          constructorsTable.content.push(
            tr([
              this._createTitleCell(apiMember),
              this._createModifiersCell(apiMember),
              this._createDescriptionCell(apiMember)
            ])
          );

          this._writeApiItemPage(apiMember);
          break;
        }
        case ApiItemKind.Method: {
          methodsTable.content.push(
            tr([
              this._createTitleCell(apiMember),
              this._createModifiersCell(apiMember),
              this._createDescriptionCell(apiMember)
            ])
          );

          this._writeApiItemPage(apiMember);
          break;
        }
        case ApiItemKind.Property: {

          if ((apiMember as ApiPropertyItem).isEventProperty) {
            eventsTable.content.push(
              tr([
                this._createTitleCell(apiMember),
                this._createModifiersCell(apiMember),
                this._createPropertyTypeCell(apiMember),
                this._createDescriptionCell(apiMember)
              ])
            );
          } else {
            propertiesTable.content.push(
              tr([
                this._createTitleCell(apiMember),
                this._createModifiersCell(apiMember),
                this._createPropertyTypeCell(apiMember),
                this._createDescriptionCell(apiMember)
              ])
            );
          }

          this._writeApiItemPage(apiMember);
          break;
        }

      }
    }

    if (eventsTable.content.length > 0) {
      output.push(tag('h3', 'section-heading', 'Events'));
      output.push(eventsTable);
    }

    if (constructorsTable.content.length > 1) {
      output.push(tag('h3', 'section-heading', 'Constructors'));
      output.push(constructorsTable);
    }

    if (propertiesTable.content.length > 1) {
      output.push(tag('h3', 'section-heading', 'Properties'));
      output.push(propertiesTable);
    }

    if (methodsTable.content.length > 1) {
      output.push(tag('h3', 'section-heading', 'Methods'));
      output.push(methodsTable);
    }
  }

  /**
   * GENERATE PAGE: ENUM
   */
  private _writeEnumTables(output: HtmlNode[], apiEnum: ApiEnum): void {
    const enumMembersTable = table([ 'Member', 'Value', 'Description' ]);

    for (const apiEnumMember of apiEnum.members) {
      enumMembersTable.content.push(tr([
        Utilities.getConciseSignature(apiEnumMember),
        apiEnumMember.initializerExcerpt.text,
        this._createDescriptionCell(apiEnumMember)
      ]));
    }

    if (enumMembersTable.content.length > 1) {
      output.push(tag('h3', 'section-heading', 'Enumeration Members'));
      output.push(enumMembersTable);
    }
  }

  /**
   * GENERATE PAGE: INTERFACE
   */
  private _writeInterfaceTables(output: HtmlNode[], apiClass: ApiInterface): void {
    const eventsTable = table([ 'Property', 'Type', 'Description' ]);
    const propertiesTable = table([ 'Property', 'Type', 'Description' ]);
    const methodsTable = table([ 'Method', 'Description' ]);

    for (const apiMember of apiClass.members) {

      switch (apiMember.kind) {
        case ApiItemKind.ConstructSignature:
        case ApiItemKind.MethodSignature: {
          methodsTable.content.push(tr([
            this._createTitleCell(apiMember),
            this._createDescriptionCell(apiMember)
          ]));

          this._writeApiItemPage(apiMember);
          break;
        }
        case ApiItemKind.PropertySignature: {

          if ((apiMember as ApiPropertyItem).isEventProperty) {
            eventsTable.content.push(tr([
              this._createTitleCell(apiMember),
              this._createPropertyTypeCell(apiMember),
              this._createDescriptionCell(apiMember)
            ]));
          } else {
            propertiesTable.content.push(tr([
              this._createTitleCell(apiMember),
              this._createPropertyTypeCell(apiMember),
              this._createDescriptionCell(apiMember)
            ]));
          }

          this._writeApiItemPage(apiMember);
          break;
        }

      }
    }

    if (eventsTable.content.length > 1) {
      output.push(tag('h3', 'section-heading', 'Events'));
      output.push(eventsTable);
    }

    if (propertiesTable.content.length > 1) {
      output.push(tag('h3', 'section-heading', 'Properties'));
      output.push(propertiesTable);
    }

    if (methodsTable.content.length > 1) {
      output.push(tag('h3', 'section-heading', 'Methods'));
      output.push(methodsTable);
    }
  }

  /**
   * GENERATE PAGE: FUNCTION-LIKE
   */
  private _writeParameterTables(output: HtmlNode[], apiParameterListMixin: ApiParameterListMixin): void {
    const parametersTable = table([ 'Parameter', 'Type', 'Description' ]);

    for (const apiParameter of apiParameterListMixin.parameters) {
      parametersTable.content.push(
        tr([
          apiParameter.name,
          apiParameter.parameterTypeExcerpt.text
        ])
      );
    }

    if (parametersTable.content.length > 1) {
      output.push(tag('h3', 'section-heading', 'Parameters'));
      output.push(parametersTable);
    }
/*
    if (ApiReturnTypeMixin.isBaseClassOf(apiParameterListMixin)) {
      const returnTypeExcerpt: Excerpt = apiParameterListMixin.returnTypeExcerpt;
      output.push(
        new DocParagraph({ configuration }, [
          new DocEmphasisSpan({ configuration, bold: true}, [
            new DocPlainText({ configuration, text: 'Returns:' })
          ])
        ])
      );

      output.push(
        new DocParagraph({ configuration }, [
          new DocCodeSpan({ configuration, code: returnTypeExcerpt.text.trim() || '(not declared)' })
        ])
      );

      if (apiParameterListMixin instanceof ApiDocumentedItem) {
        if (apiParameterListMixin.tsdocComment && apiParameterListMixin.tsdocComment.returnsBlock) {
          this._appendSection(output, apiParameterListMixin.tsdocComment.returnsBlock.content);
        }
      }
    }
*/
  }

  private _createTitleCell(apiItem: ApiItem): HtmlNode {
    return a(
      Utilities.getConciseSignature(apiItem),
      this._getLinkFilenameForApiItem(apiItem),
      'ref',
    );
  }

  /**
   * This generates a DocTableCell for an ApiItem including the summary section and "(BETA)" annotation.
   *
   * @remarks
   * We mostly assume that the input is an ApiDocumentedItem, but it's easier to perform this as a runtime
   * check than to have each caller perform a type cast.
   */
  private _createDescriptionCell(apiItem: ApiItem): HtmlNode {
//    const section: DocSection = new DocSection({ configuration });
/*
    if (ApiReleaseTagMixin.isBaseClassOf(apiItem)) {
      if (apiItem.releaseTag === ReleaseTag.Beta) {
        section.appendNodesInParagraph([
          new DocEmphasisSpan({ configuration, bold: true, italic: true }, [
            new DocPlainText({ configuration, text: '(BETA)' })
          ]),
          new DocPlainText({ configuration, text: ' ' })
        ]);
      }
    }
*/

    if (apiItem instanceof ApiDocumentedItem) {
      if (apiItem.tsdocComment !== undefined) {
        return tag('div', 'description', this._createDocNodes(apiItem.tsdocComment.summarySection.nodes));
      }
    }

    return tag('div', 'description', []);
  }

  private _createModifiersCell(apiItem: ApiItem): HtmlNode {
    if (ApiStaticMixin.isBaseClassOf(apiItem)) {
      if (apiItem.isStatic) {
        return tag('code', 'modifiers', 'static');
      }
    }

    return tag('div', 'modifiers');
  }

  private _createPropertyTypeCell(apiItem: ApiItem): HtmlNode {
    if (apiItem instanceof ApiPropertyItem) {
      return tag('code', 'type', apiItem.propertyTypeExcerpt.text);
    }

    return tag('code', 'type');
  }

  private _writeBreadcrumb(output: HtmlNode[], apiItem: ApiItem): void {
    output.push(a('Home', this._getLinkFilenameForApiItem(this._apiModel), 'breadcrumb'));

    for (const hierarchyItem of apiItem.getHierarchy()) {
      switch (hierarchyItem.kind) {
        case ApiItemKind.Model:
        case ApiItemKind.EntryPoint:
          // We don't show the model as part of the breadcrumb because it is the root-level container.
          // We don't show the entry point because today API Extractor doesn't support multiple entry points;
          // this may change in the future.
          break;
        default:
          output.push(tag('span', 'breadcrumb', ' / '));
          output.push(a(hierarchyItem.displayName, this._getLinkFilenameForApiItem(hierarchyItem), 'breadcrumb'));
      }
    }
  }

  private _writeBetaWarning(output: HtmlNode[]): void {
/*
    const configuration: TSDocConfiguration = this._tsdocConfiguration;
    const betaWarning: string = 'This API is provided as a preview for developers and may change'
      + ' based on feedback that we receive.  Do not use this API in a production environment.';
    output.push(
      new DocNoteBox({ configuration }, [
        new DocParagraph({ configuration }, [
          new DocPlainText({ configuration, text: betaWarning })
        ])
      ])
    );
*/
  }

  private _createDocNodes(nodes: readonly DocNode[]): HtmlNode[] {
    return nodes.map(node => {
      switch (node.kind) {
        case DocNodeKind.Paragraph:
          const paragraph = node as DocParagraph;
          return tag('p', this._createDocNodes(paragraph.nodes));
        case DocNodeKind.SoftBreak:
          return undefined;
        case DocNodeKind.CodeSpan:
          const code = node as DocCodeSpan;
          return tag('code', code.code);
        case DocNodeKind.LinkTag:
          const link = node as DocLinkTag;
          if (link.urlDestination) {
            return a(link.linkText || link.urlDestination, link.urlDestination);
          } else {
            console.warn('DocLinkTag with codeDestination not supported')
            return a(link.linkText || 'Missing Link', 'missing-link');
          }
        case DocNodeKind.PlainText:
          const plainText = node as DocPlainText;
          return tag('span', plainText.text);
        default:
          throw new Error('Unsupported DocNode kind: ' + node.kind);
      }
    }).filter(n => !!n) as HtmlNode[];
  }

  private _getFilenameForApiItem(apiItem: ApiItem): string {
    if (apiItem.kind === ApiItemKind.Model) {
      return 'index.html';
    }

    let baseName: string = '';
    for (const hierarchyItem of apiItem.getHierarchy()) {
      // For overloaded methods, add a suffix such as "MyClass.myMethod_2".
      let qualifiedName: string = Utilities.getSafeFilenameForName(hierarchyItem.displayName);
      if (ApiParameterListMixin.isBaseClassOf(hierarchyItem)) {
        if (hierarchyItem.overloadIndex > 1) {
          // Subtract one for compatibility with earlier releases of API Documenter.
          // (This will get revamped when we fix GitHub issue #1308)
          qualifiedName += `_${hierarchyItem.overloadIndex - 1}`;
        }
      }

      switch (hierarchyItem.kind) {
        case ApiItemKind.Model:
        case ApiItemKind.EntryPoint:
          break;
        case ApiItemKind.Package:
          baseName = Utilities.getSafeFilenameForName(PackageName.getUnscopedName(hierarchyItem.displayName));
          break;
        default:
          baseName += '.' + qualifiedName;
      }
    }
    return baseName + '.html';
  }

  private _getLinkFilenameForApiItem(apiItem: ApiItem): string {
    return './' + this._getFilenameForApiItem(apiItem);
  }

  private _deleteOldOutputFiles(): void {
    console.log('Deleting old output from ' + this._outputFolder);
    FileSystem.ensureEmptyFolder(this._outputFolder);
  }
}
