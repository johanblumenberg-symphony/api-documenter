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
  DocLinkTag,
  DocEscapedText,
  DocBlock,
  StandardTags,
  DocFencedCode,
  DocInlineTag,
  DocHtmlStartTag,
  DocHtmlEndTag
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
  ApiParameterListMixin,
  ApiDeclaredItem,
  ApiNamespace,
  ExcerptTokenKind,
  Excerpt,
  ApiReturnTypeMixin,
  IResolveDeclarationReferenceResult
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
  HtmlEmitter,
  tag,
  table,
  tr,
  a,
} from '../html/HtmlEmitter';

function isApiDeclaredItem(apiItem: ApiItem): apiItem is ApiDeclaredItem {
  return apiItem instanceof ApiDeclaredItem;
}

class CustomHtmlEmitter extends HtmlEmitter {
  constructor(public contextApiItem: ApiItem) {
    super();
  }
}

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
    FileSystem.copyFile({
      sourcePath: require.resolve('../html/logo.png'),
      destinationPath: path.join(outputFolder, 'logo.png'),
    });

    this._writeApiItemPage(this._apiModel);

    if (this._pluginLoader.markdownDocumenterFeature) {
      this._pluginLoader.markdownDocumenterFeature.onFinished({ });
    }
  }

  private _writeApiItemPage(apiItem: ApiItem): void {
    const siblings = apiItem.getMergedSiblings();
    const interfaces = siblings.filter(s => s.kind == ApiItemKind.Interface);
    const namespaces = siblings.filter(s => s.kind == ApiItemKind.Namespace);

    if (interfaces.length === 1 && namespaces.length === 1 && siblings.length === 2) {
      if (apiItem.kind === ApiItemKind.Interface) {
        this._writeApiItemPageWithSiblings([ ...interfaces, ...namespaces ]);
      }
    } else {
      this._writeApiItemPageWithSiblings([ apiItem ]);
    }
  }

  private _writeApiItemPageWithSiblings(apiItems: readonly ApiItem[]): void {
    const output = new CustomHtmlEmitter(apiItems[0]);
    output.addStyle('styles.css');

    output.appendChild(
      tag('header', [
        tag('div', 'header-top', [
          a('', 'https://developers.symphony.com/', 'header-logo')
        ]),
        tag('div', 'header-bottom', [])
      ]),
    );
    output.openNode(tag('div', 'main', []));

    this._writeBreadcrumb(output, apiItems[0]);

    const scopedName: string = apiItems[0].getScopedNameWithinPackage();

    switch (apiItems[0].kind) {
      case ApiItemKind.Class:
        output.appendChild(tag('h1', 'page-header', `${scopedName} class`));
        break;
      case ApiItemKind.Enum:
        output.appendChild(tag('h1', 'page-header', `${scopedName} enum`));
        break;
      case ApiItemKind.Interface:
        output.appendChild(tag('h1', 'page-header', `${scopedName} interface`));
        break;
      case ApiItemKind.Constructor:
      case ApiItemKind.ConstructSignature:
        output.appendChild(tag('h1', 'page-header', `${scopedName}`));
        break;
      case ApiItemKind.Method:
      case ApiItemKind.MethodSignature:
        output.appendChild(tag('h1', 'page-header', `${scopedName} method`));
        break;
      case ApiItemKind.Function:
        output.appendChild(tag('h1', 'page-header', `${scopedName} function`));
        break;
      case ApiItemKind.Model:
        output.appendChild(tag('h1', 'page-header', `${scopedName} API Reference`));
        break;
      case ApiItemKind.Namespace:
        output.appendChild(tag('h1', 'page-header', `${scopedName} namespace`));
        break;
      case ApiItemKind.Package:
        console.log(`Writing ${apiItems[0].displayName} package`);
        const unscopedPackageName: string = PackageName.getUnscopedName(apiItems[0].displayName);
        output.appendChild(tag('h1', 'page-header', `${unscopedPackageName} package`));
        break;
      case ApiItemKind.Property:
      case ApiItemKind.PropertySignature:
        output.appendChild(tag('h1', 'page-header', `${scopedName} property`));
        break;
      case ApiItemKind.TypeAlias:
        output.appendChild(tag('h1', 'page-header', `${scopedName} type`));
        break;
      case ApiItemKind.Variable:
        output.appendChild(tag('h1', 'page-header', `${scopedName} variable`));
        break;
      default:
        throw new Error('Unsupported API item kind: ' + apiItems[0].kind);
    }

    if (apiItems.some(apiItem => ApiReleaseTagMixin.isBaseClassOf(apiItem) && apiItem.releaseTag === ReleaseTag.Beta)) {
      this._writeBetaWarning(output);
    }

    apiItems.forEach(apiItem => {
      if (apiItem instanceof ApiDocumentedItem) {
        const tsdocComment: DocComment | undefined = apiItem.tsdocComment;

        if (tsdocComment) {

  /*
          if (tsdocComment.deprecatedBlock) {
            output.appendChild(
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

          output.appendChild(tag('div', 'summary', this._createDocNodes(tsdocComment.summarySection.nodes, output.contextApiItem)));
        }
      }
    });

    const signatures = apiItems.filter(isApiDeclaredItem).filter(apiItem => apiItem.excerpt.text.length > 0);
    if (signatures.length > 0) {
      output.appendChild(tag('div', 'signature-heading', 'Signature'));
    }
    signatures.forEach(apiItem => {
      output.appendChild(tag('pre', 'signature', apiItem.getExcerptWithModifiers()));
    });

    apiItems.forEach(apiItem => {
      this._writeRemarksSection(output, apiItem);
    });

    apiItems.forEach(apiItem => {
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
    });

    output.closeNode('div');

    const filename: string = path.join(this._outputFolder, this._getFilenameForApiItem(apiItems[0]));
    let pageContent = output.emit();

    FileSystem.writeFile(filename, pageContent, {
      convertLineEndings: this._documenterConfig ? this._documenterConfig.newlineKind : NewlineKind.CrLf
    });
  }

  private _writeRemarksSection(output: CustomHtmlEmitter, apiItem: ApiItem): void {
    if (apiItem instanceof ApiDocumentedItem) {
      const tsdocComment: DocComment | undefined = apiItem.tsdocComment;

      if (tsdocComment) {
        // Write the @remarks block
        if (tsdocComment.remarksBlock) {
          output.appendChild(tag('h3', 'section-heading', 'Remarks'));
          output.appendChild(tag('div', this._createDocNodes(tsdocComment.remarksBlock.content.nodes, output.contextApiItem)));
        }

/*
        // Write the @example blocks
        const exampleBlocks: DocBlock[] = tsdocComment.customBlocks.filter(x => x.blockTag.tagNameWithUpperCase
          === StandardTags.example.tagNameWithUpperCase);

        let exampleNumber: number = 1;
        for (const exampleBlock of exampleBlocks) {
          const heading: string = exampleBlocks.length > 1 ? `Example ${exampleNumber}` : 'Example';

          output.appendChild(new DocHeading({ configuration: this._tsdocConfiguration, title: heading }));

          this._appendSection(output, exampleBlock.content);

          ++exampleNumber;
        }
*/
      }
    }
  }

  private _writeThrowsSection(output: CustomHtmlEmitter, apiItem: ApiItem): void {
    if (apiItem instanceof ApiDocumentedItem) {
      const tsdocComment: DocComment | undefined = apiItem.tsdocComment;
      
      if (tsdocComment) {
        const throwsBlocks: DocBlock[] = tsdocComment.customBlocks.filter(x => x.blockTag.tagNameWithUpperCase
          === StandardTags.throws.tagNameWithUpperCase);

        output.appendChild(tag('h3', 'section-heading', 'Throws'));
        const exceptionsTable = table([ 'Error' ]);
              
        for (const throwsBlock of throwsBlocks) {
          const row = tr([ tag('span', this._createDocNodes(throwsBlock.content.nodes, output.contextApiItem)) ]);
          exceptionsTable.content.push(row);
        }

        output.appendChild(exceptionsTable);
      }
    }
  }

  /**
   * GENERATE PAGE: MODEL
   */
  private _writeModelTable(output: CustomHtmlEmitter, apiModel: ApiModel): void {
    const packagesTable = table([ 'Package', 'Description' ]);

    for (const apiMember of apiModel.members) {
      const row = tr([ this._createTitleCell(apiMember), this._createDescriptionCell(apiMember, output.contextApiItem) ]);

      switch (apiMember.kind) {
        case ApiItemKind.Package:
          packagesTable.content.push(row);
          this._writeApiItemPage(apiMember);
          break;
      }
    }

    if (packagesTable.content.length > 0) {
      output.appendChild(tag('h3', 'section-heading', 'Packages'));
      output.appendChild(packagesTable);
    }
  }

  /**
   * GENERATE PAGE: PACKAGE or NAMESPACE
   */
  private _writePackageOrNamespaceTables(output: CustomHtmlEmitter, apiContainer: ApiPackage | ApiNamespace): void {
    const classesTable = table([ 'Class', 'Description' ]);
    const enumerationsTable = table([ 'Enumeration', 'Description' ]);
    const functionsTable = table([ 'Function', 'Description' ]);
    const interfacesTable = table([ 'Interface', 'Description' ]);
    const exceptionsTable = table([ 'Exception', 'Description' ]);
    const namespacesTable = table([ 'Namespace', 'Description' ]);
    const variablesTable= table([ 'Variable', 'Description' ]);
    const typeAliasesTable = table([ 'Type Alias', 'Description' ]);

    const apiMembers: ReadonlyArray<ApiItem> = apiContainer.kind === ApiItemKind.Package ?
      (apiContainer as ApiPackage).entryPoints[0].members
      : (apiContainer as ApiNamespace).members;

    function isError(item: ApiClass) {
      if (item.extendsType && item.extendsType.excerpt) {
        return item.extendsType.excerpt.tokens.some(token => {
          if (token.kind === ExcerptTokenKind.Reference) {
            if (token.text === 'Error') {
              return true;
            }
          }
          return false;
        });
      }
      return false;
    }

    for (const apiMember of apiMembers) {

      const row = tr([
        this._createTitleCell(apiMember),
        this._createDescriptionCell(apiMember, output.contextApiItem)
      ]);

      switch (apiMember.kind) {
        case ApiItemKind.Class:
          if (!isError(apiMember as ApiClass)) {
            classesTable.content.push(row);
          } else {
            exceptionsTable.content.push(row);            
          }
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
      output.appendChild(tag('h3', 'section-heading', 'Classes'));
      output.appendChild(classesTable);
    }

    if (enumerationsTable.content.length > 1) {
      output.appendChild(tag('h3', 'section-heading', 'Enumerations'));
      output.appendChild(enumerationsTable);
    }
    if (functionsTable.content.length > 1) {
      output.appendChild(tag('h3', 'section-heading', 'Functions'));
      output.appendChild(functionsTable);
    }

    if (interfacesTable.content.length > 1) {
      output.appendChild(tag('h3', 'section-heading', 'Interfaces'));
      output.appendChild(interfacesTable);
    }

    if (namespacesTable.content.length > 1) {
      output.appendChild(tag('h3', 'section-heading', 'Namespaces'));
      output.appendChild(namespacesTable);
    }

    if (variablesTable.content.length > 1) {
      output.appendChild(tag('h3', 'section-heading', 'Variables'));
      output.appendChild(variablesTable);
    }

    if (typeAliasesTable.content.length > 1) {
      output.appendChild(tag('h3', 'section-heading', 'Types'));
      output.appendChild(typeAliasesTable);
    }

    if (exceptionsTable.content.length > 1) {
      output.appendChild(tag('h3', 'section-heading', 'Exceptions'));
      output.appendChild(exceptionsTable);
    }
  }

  /**
   * GENERATE PAGE: CLASS
   */
  private _writeClassTables(output: CustomHtmlEmitter, apiClass: ApiClass): void {
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
              this._createDescriptionCell(apiMember, output.contextApiItem)
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
              this._createDescriptionCell(apiMember, output.contextApiItem)
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
                this._createDescriptionCell(apiMember, output.contextApiItem)
              ])
            );
          } else {
            propertiesTable.content.push(
              tr([
                this._createTitleCell(apiMember),
                this._createModifiersCell(apiMember),
                this._createPropertyTypeCell(apiMember),
                this._createDescriptionCell(apiMember, output.contextApiItem)
              ])
            );
          }

          this._writeApiItemPage(apiMember);
          break;
        }

      }
    }

    if (eventsTable.content.length > 1) {
      output.appendChild(tag('h3', 'section-heading', 'Events'));
      output.appendChild(eventsTable);
    }

    if (constructorsTable.content.length > 1) {
      output.appendChild(tag('h3', 'section-heading', 'Constructors'));
      output.appendChild(constructorsTable);
    }

    if (propertiesTable.content.length > 1) {
      output.appendChild(tag('h3', 'section-heading', 'Properties'));
      output.appendChild(propertiesTable);
    }

    if (methodsTable.content.length > 1) {
      output.appendChild(tag('h3', 'section-heading', 'Methods'));
      output.appendChild(methodsTable);
    }
  }

  /**
   * GENERATE PAGE: ENUM
   */
  private _writeEnumTables(output: CustomHtmlEmitter, apiEnum: ApiEnum): void {
    const enumMembersTable = table([ 'Member', 'Value', 'Description' ]);

    for (const apiEnumMember of apiEnum.members) {
      enumMembersTable.content.push(tr([
        Utilities.getConciseSignature(apiEnumMember),
        apiEnumMember.initializerExcerpt.text,
        this._createDescriptionCell(apiEnumMember, output.contextApiItem)
      ]));
    }

    if (enumMembersTable.content.length > 1) {
      output.appendChild(tag('h3', 'section-heading', 'Enumeration Members'));
      output.appendChild(enumMembersTable);
    }
  }

  /**
   * GENERATE PAGE: INTERFACE
   */
  private _writeInterfaceTables(output: CustomHtmlEmitter, apiClass: ApiInterface): void {
    const eventsTable = table([ 'Property', 'Type', 'Description' ]);
    const propertiesTable = table([ 'Property', 'Type', 'Description' ]);
    const methodsTable = table([ 'Method', 'Description' ]);

    for (const apiMember of apiClass.members) {

      switch (apiMember.kind) {
        case ApiItemKind.ConstructSignature:
        case ApiItemKind.MethodSignature: {
          methodsTable.content.push(tr([
            this._createTitleCell(apiMember),
            this._createDescriptionCell(apiMember, output.contextApiItem)
          ]));

          this._writeApiItemPage(apiMember);
          break;
        }
        case ApiItemKind.PropertySignature: {

          if ((apiMember as ApiPropertyItem).isEventProperty) {
            eventsTable.content.push(tr([
              this._createTitleCell(apiMember),
              this._createPropertyTypeCell(apiMember),
              this._createDescriptionCell(apiMember, output.contextApiItem)
            ]));
          } else {
            propertiesTable.content.push(tr([
              this._createTitleCell(apiMember),
              this._createPropertyTypeCell(apiMember),
              this._createDescriptionCell(apiMember, output.contextApiItem)
            ]));
          }

          this._writeApiItemPage(apiMember);
          break;
        }

      }
    }

    if (eventsTable.content.length > 1) {
      output.appendChild(tag('h3', 'section-heading', 'Events'));
      output.appendChild(eventsTable);
    }

    if (propertiesTable.content.length > 1) {
      output.appendChild(tag('h3', 'section-heading', 'Properties'));
      output.appendChild(propertiesTable);
    }

    if (methodsTable.content.length > 1) {
      output.appendChild(tag('h3', 'section-heading', 'Methods'));
      output.appendChild(methodsTable);
    }
  }

  /**
   * GENERATE PAGE: FUNCTION-LIKE
   */
  private _writeParameterTables(output: CustomHtmlEmitter, apiParameterListMixin: ApiParameterListMixin): void {
    const parametersTable = table([ 'Parameter', 'Type', 'Description' ]);
    let description: HtmlNode | string = '';

    for (const apiParameter of apiParameterListMixin.parameters) {
      if (apiParameter.tsdocParamBlock) {
        description = this._createDocNodes(apiParameter.tsdocParamBlock.content.nodes, output.contextApiItem)[0];
      }
      parametersTable.content.push(
          tr([
            apiParameter.name,
            apiParameter.parameterTypeExcerpt.text,
            description
          ])
      );
    }

    if (parametersTable.content.length > 1) {
      output.appendChild(tag('h3', 'section-heading', 'Parameters'));
      output.appendChild(parametersTable);
    }

    if (ApiReturnTypeMixin.isBaseClassOf(apiParameterListMixin)) {
      if (apiParameterListMixin instanceof ApiDocumentedItem) {
        if (apiParameterListMixin.tsdocComment && apiParameterListMixin.tsdocComment.returnsBlock) {

          const returnTypeExcerpt: Excerpt = apiParameterListMixin.returnTypeExcerpt;
          const returnsTable = table(['Type', 'Description' ]);

          returnsTable.content.push(tr([
            returnTypeExcerpt.text.trim(),
            this._createDocNodes(apiParameterListMixin.tsdocComment.returnsBlock.content.nodes, output.contextApiItem)[0],
          ]));

          output.appendChild(tag('h3', 'section-heading', 'Returns'));
          output.appendChild(returnsTable);
        }
      }
    }
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
  private _createDescriptionCell(apiItem: ApiItem, contextApiItem: ApiItem): HtmlNode {
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
        return tag('div', 'description', this._createDocNodes(apiItem.tsdocComment.summarySection.nodes, contextApiItem));
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

  private _writeBreadcrumb(output: HtmlEmitter, apiItem: ApiItem): void {
    output.appendChild(a('Home', this._getLinkFilenameForApiItem(this._apiModel), 'breadcrumb'));

    for (const hierarchyItem of apiItem.getHierarchy()) {
      switch (hierarchyItem.kind) {
        case ApiItemKind.Model:
        case ApiItemKind.EntryPoint:
          // We don't show the model as part of the breadcrumb because it is the root-level container.
          // We don't show the entry point because today API Extractor doesn't support multiple entry points;
          // this may change in the future.
          break;
        default:
          output.appendChild(tag('span', 'breadcrumb', ' / '));
          output.appendChild(a(hierarchyItem.displayName, this._getLinkFilenameForApiItem(hierarchyItem), 'breadcrumb'));
      }
    }
  }

  private _writeBetaWarning(output: HtmlEmitter): void {
/*
    const configuration: TSDocConfiguration = this._tsdocConfiguration;
    const betaWarning: string = 'This API is provided as a preview for developers and may change'
      + ' based on feedback that we receive.  Do not use this API in a production environment.';
    output.appendChild(
      new DocNoteBox({ configuration }, [
        new DocParagraph({ configuration }, [
          new DocPlainText({ configuration, text: betaWarning })
        ])
      ])
    );
*/
  }

  private _createDocNodes(nodes: readonly DocNode[], contextApiItem: ApiItem): HtmlNode[] {
    const result = new HtmlEmitter();

    nodes.forEach(node => {
      switch (node.kind) {
        case DocNodeKind.Paragraph:
          const paragraph = node as DocParagraph;
          result.appendChild(tag('p', this._createDocNodes(paragraph.nodes, contextApiItem)));
          break;
        case DocNodeKind.Block:
          const block = node as DocBlock;
          result.appendChild(tag('div', this._createDocNodes(block.content.nodes, contextApiItem)));
          break;
        case DocNodeKind.InlineTag:
          const blocktag = node as DocInlineTag;
          result.appendChild(tag('span', blocktag.tagName));
          break;
        case DocNodeKind.SoftBreak:
          break;
        case DocNodeKind.CodeSpan:
          const code = node as DocCodeSpan;
          result.appendChild(tag('code', code.code));
          break;
        case DocNodeKind.FencedCode:
          const fcode = node as DocFencedCode;
          result.appendChild(tag('pre', fcode.code));
          break;
        case DocNodeKind.EscapedText:
          const escapedText = node as DocEscapedText;
          result.appendChild(tag('span', escapedText.decodedText));
          break;
        case DocNodeKind.LinkTag:
          const link = node as DocLinkTag;
          if (link.urlDestination) {
            result.appendChild(a(link.linkText || link.urlDestination, link.urlDestination));
          } else if (link.codeDestination) {
            const lookup: IResolveDeclarationReferenceResult = this._apiModel.resolveDeclarationReference(
              link.codeDestination,
              contextApiItem,
            );

            if (lookup.resolvedApiItem) {
              const filename = this._getLinkFilenameForApiItem(lookup.resolvedApiItem);
              let linkText: string = link.linkText || lookup.resolvedApiItem.getScopedNameWithinPackage();
              result.appendChild(a(linkText, filename));
            } else if (lookup.errorMessage) {
              console.log(
                  `WARNING: Unable to resolve reference "${link.codeDestination.emitAsTsdoc()}": ${lookup.errorMessage}`
              );
            }
          }
          break;
        case DocNodeKind.PlainText:
          const plainText = node as DocPlainText;
          result.appendChild(tag('span', plainText.text));
          break;
        case DocNodeKind.HtmlStartTag:
          const htmlStartTag = node as DocHtmlStartTag;
          result.openNode(tag(htmlStartTag.name, []));
          break;
        case DocNodeKind.HtmlEndTag:
          const htmlEndTag = node as DocHtmlEndTag;
          result.closeNode(htmlEndTag.name);
          break;
        default:
          throw new Error('Unsupported DocNode kind: ' + node.kind);
      }
    });

    return result.root().content;
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
