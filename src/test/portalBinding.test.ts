import * as assert from 'assert';
import { anyString, anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import BufferBinding from '../BufferBinding';
import { IBufferSync } from '../sync/iBufferSync';
import * as vscode from 'vscode';
import { MockableApis } from '../base/mockableApis';
import { ManualCyclicExecutor } from './manualCyclicExecutor';
import { Volume } from "memfs"
import { Position } from '../sync/data/position';
import { TextChange, TextChangeType } from '../sync/data/textChange';
import { MemoryEditor } from './memoryEditor';
import EditorBinding from '../EditorBinding';
import { IEditorSync } from '../sync/iEditorSync';
import { Selection } from '../sync/data/selection';
import { MemoryWindow } from './memoryWindow';
import { MemoryWorkspace } from './memoryWorkspace';
import { ISyncPortal } from '../sync/iSyncPortal';
import PortalBinding from '../PortalBinding';
import * as os from 'os';
import * as path from 'path';
import { fileUrl } from '../base/functions';
import { MemorySyncPortal } from '../sync/memory/memorySyncPortal';
import { MemoryEditorSync } from '../sync/memory/memoryEditorSync';
import { MockWrapper } from './mockWrapper';


suite("PortalBinding", function () {

    let mockEditorClass = mock<vscode.TextEditor>();
    let mockEditor = instance(mockEditorClass);
    (mockEditor as any).document = {
        fileName: "test.txt"
    };
    
    var commandsClass = mock() as any;
    var fsPromisesClass = mock() as any;
    
    let vol = Volume.fromJSON({
        "test.txt" : "abc"
    }, os.tmpdir());
    var memoryWorkspace = new MemoryWorkspace();
    var memoryWindow = new MemoryWindow();
    var syncPortal = new MemorySyncPortal();

    setup(() => {
        memoryWorkspace = new MemoryWorkspace();
        memoryWindow = new MemoryWindow();
        fsPromisesClass = mock() as any;
        commandsClass = mock() as any;
        MockableApis.fs = vol;
        MockableApis.fsPromises = instance(fsPromisesClass);
        MockableApis.window = memoryWindow;
        MockableApis.workspace = memoryWorkspace;
        MockableApis.commands = instance(commandsClass);
        MockableApis.window.activeTextEditor = mockEditor;
        syncPortal = new MemorySyncPortal();
    });

    test("test open remote file client", async function() {   
        let portalBinding = await createAndInitPortalBinding(syncPortal, false);     
        await testOpenRemoteFile(portalBinding, fsPromisesClass, vol, memoryWorkspace, memoryWindow, commandsClass);
    });

    test("test open remote file host", async function() {   
        let portalBinding = await createAndInitPortalBinding(syncPortal, true);     
        await testOpenRemoteFile(portalBinding, fsPromisesClass, vol, memoryWorkspace, memoryWindow, commandsClass);
    });

    test("test open local file host", async function() {   
        await createAndInitPortalBinding(syncPortal, true);     
        let editor = new MemoryEditor();
        (editor as any).document = {
            fileName : "test.txt"
        };
        await memoryWindow.activeTextEditorChangeListener!(editor);
        assert.strictEqual(syncPortal.localFiles.length, 2);
        assert.strictEqual(syncPortal.localFiles[0], "test.txt");
        assert.strictEqual(syncPortal.localFiles[1], "test.txt");

        await memoryWindow.activeTextEditorChangeListener!(editor);
        assert.strictEqual(syncPortal.localFiles.length, 2);
    });

    test("test open local file client", async function() {   
        await createAndInitPortalBinding(syncPortal, false);     
        let editor = new MemoryEditor();
        (editor as any).document = {
            fileName : "test.txt"
        };
        await memoryWindow.activeTextEditorChangeListener!(editor);
        assert.strictEqual(syncPortal.localFiles.length, 0);
    });

    test("test close local text editor client", async () => {
        let portalBinding = await createAndInitPortalBinding(syncPortal, false);     
        let editorSync = await testOpenRemoteFile(portalBinding, fsPromisesClass, vol, memoryWorkspace, memoryWindow, commandsClass);
        memoryWindow.changeVisibleTextEditorListener!([]);
        verify(editorSync.value.close()).twice();
    });

    test("test close local text editor host", async () => {
        let portalBinding = await createAndInitPortalBinding(syncPortal, true);     
        let editorSync = await testOpenRemoteFile(portalBinding, fsPromisesClass, vol, memoryWorkspace, memoryWindow, commandsClass);
        memoryWindow.changeVisibleTextEditorListener!([]);
        verify(editorSync.value.close()).twice();
    });

});



async function createAndInitPortalBinding(syncPortal: MemorySyncPortal, isHost : boolean) : Promise<PortalBinding> {
    let portalBinding = new PortalBinding(syncPortal, isHost);
    await portalBinding.initialize();
    assert.strictEqual(syncPortal.localFiles.length, isHost ? 1: 0);
    assertBindings(syncPortal);
    return portalBinding;
}

async function testOpenRemoteFile(portalBinding: PortalBinding, fsPromisesClass: any, vol : any, memoryWorkspace: MemoryWorkspace, memoryWindow: MemoryWindow, commandsClass: any) {
    let mockEditorSyncClass = mock<IEditorSync>();
    let mockEditorSync = instance(mockEditorSyncClass);
    let mockBufferSyncClass = mock<IBufferSync>();
    let mockBufferSync = instance(mockBufferSyncClass);
    (mockEditorSync as any).bufferSync = mockBufferSync;
    when(mockEditorSyncClass.getBufferSync()).thenReturn(mockBufferSync);

    await portalBinding.onOpenRemoteFile("test.txt", mockEditorSync);
    verify(fsPromisesClass.mkdir(os.tmpdir(), deepEqual({ recursive: true }))).once();
    let content = vol.readFileSync(path.join(os.tmpdir(), "test.txt")).toString();
    assert.strictEqual(content, "");
    assert.strictEqual(memoryWorkspace.openedTextDocuments.size, 1);
    let expectedUri = vscode.Uri.parse(fileUrl(path.join(os.tmpdir(), "test.txt")));
    //access fsPath, as otherwise it won't be filled in the object and the comparison will fail
    expectedUri.fsPath;
    assert.deepStrictEqual(memoryWorkspace.openedTextDocuments.keys().next().value, expectedUri);
    assert.strictEqual(memoryWindow.createdTextEditors.size, 1);
    verify(commandsClass.executeCommand('workbench.action.keepEditor')).once();

    //TODO: Test closed editor
    var oldEditor = memoryWindow.createdTextEditors.values().next().value;
    await portalBinding.onOpenRemoteFile("test.txt", mockEditorSync);
    verify(fsPromisesClass.mkdir(os.tmpdir(), deepEqual({ recursive: true }))).once();
    assert.strictEqual(memoryWorkspace.openedTextDocuments.size, 1);
    assert.strictEqual(memoryWindow.createdTextEditors.size, 1);
    assert.notStrictEqual(memoryWindow.createdTextEditors.values().next().value, oldEditor);
    verify(commandsClass.executeCommand('workbench.action.keepEditor')).twice();

    //TODO: Test existing editor
    oldEditor = memoryWindow.createdTextEditors.values().next().value;
    memoryWindow.visibleTextEditors.push(...memoryWindow.createdTextEditors.values());
    await portalBinding.onOpenRemoteFile("test.txt", mockEditorSync);
    verify(fsPromisesClass.mkdir(os.tmpdir(), deepEqual({ recursive: true }))).once();
    assert.strictEqual(memoryWorkspace.openedTextDocuments.size, 1);
    assert.strictEqual(memoryWindow.createdTextEditors.size, 1);
    assert.strictEqual(memoryWindow.createdTextEditors.values().next().value, oldEditor);
    verify(commandsClass.executeCommand('workbench.action.keepEditor')).twice();

    return new MockWrapper(mockEditorSyncClass);
}

function assertBindings(syncPortal: MemorySyncPortal) {
    assert.ok(syncPortal.listener);
    assert.ok(MockableApis.window.activeTextEditorChangeListener);
    assert.ok(MockableApis.window.textEditorSelectionChangeListener);
    assert.ok(MockableApis.window.changeVisibleTextEditorListener);
    assert.ok(MockableApis.workspace.changeTextDocumentListener);
    assert.ok(MockableApis.workspace.willSaveTextDocumentListener);
}
