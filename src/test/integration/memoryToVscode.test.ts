import assert = require('assert');
import * as vscode from 'vscode';
import { MockableApis } from "../../base/mockableApis";
import { Position } from '../../sync/data/position';
import { TextChange, TextChangeType } from '../../sync/data/textChange';
import { MemoryBufferSync } from "../../sync/memory/memoryBufferSync";
import { MemoryEditorSync } from "../../sync/memory/memoryEditorSync";
import { MemorySyncPortal } from "../../sync/memory/memorySyncPortal";
import * as temp from 'temp';
import { fileUrl, sleep } from '../../base/functions';
import { IBufferListener } from '../../sync/iBufferListener';
import * as fs from 'fs';
import { ExtensionContext } from '../../extensionContext';
import { SyncConnection } from '../../binding/syncConnection';
import { CachedSyncPortal } from '../../cache/cachedSyncPortal';
import { pollEqual } from '../poller';

suite("MemoryToVscodeTest", function () {

    let extensionContext = ExtensionContext.default();
    let memorySyncPortal = new MemorySyncPortal();    
    let syncPortal = new CachedSyncPortal(memorySyncPortal, extensionContext, "test");
    let syncConnection = new SyncConnection(extensionContext, syncPortal, "test", false);
    try {
        vscode.workspace.registerFileSystemProvider("collabfs",extensionContext.collabFs, {isCaseSensitive: true});
    } catch(error) {
        //in that case we are running with a vscode instance that already has our plugin installed and the provider registered
    }

    suiteSetup(async () => {
        MockableApis.restore();
        syncConnection.initialize();
        
    });

    setup(async () => {
        await closeOpenWindows();
        await closeOpenWindows();
        memorySyncPortal.localFiles = [];
        memorySyncPortal.activeEditorSync = null;
    });

    test("test open remote file and edit", async () => {
        let editorSync = new MemoryEditorSync();
        await syncPortal.onOpenRemoteFile("peer","test.txt", vscode.Uri.parse("file://none"), editorSync);
        await syncPortal.onActivateRemoveFile(editorSync);
        await syncConnection.shareRemoteToLocal.activateRemoteFile(syncPortal.cachesBySync.get(editorSync)!);
        let activeEditor = vscode.window.activeTextEditor;
        let bufferSync = (editorSync.getBufferSync() as MemoryBufferSync);
        let bufferListener =  bufferSync.listener!;
        await bufferListener.onSetText("Halo");
        await pollEqual(1000, "Halo", () => activeEditor?.document.getText());
        await remoteEdit(activeEditor, bufferListener, bufferSync);
        await bufferListener.onSetText("Halo");
        await pollEqual(1000, "Halo", () => activeEditor?.document.getText());
        await localEdit(activeEditor!, bufferSync);
    });

    test("Test open local file, edit and save", async () => {
        let tmpFile = temp.openSync("sync_");
        fs.writeFileSync(tmpFile.path, "Halo");
        
        let buffer = await vscode.workspace.openTextDocument(vscode.Uri.parse(fileUrl(tmpFile.path)));
        let editor = await vscode.window.showTextDocument(buffer);
        await syncConnection.shareLocalToRemote.shareFile(buffer.uri);
        

        assert.strictEqual(memorySyncPortal.localFiles.length, 1);
        let editorSync = memorySyncPortal.editorSyncFiles.keys().next().value;
        assert.ok(editorSync);
        let bufferSync = editorSync.getBufferSync() as MemoryBufferSync;
        assert.ok(bufferSync);

        assert.strictEqual(bufferSync.localChanges.length, 1);
        assert.deepStrictEqual(bufferSync.localChanges[0], new TextChange(TextChangeType.UPDATE, new Position(0, 0), new Position(0, 0), "Halo"));

        bufferSync.localChanges = [];

        await remoteEdit(editor, bufferSync.listener!, bufferSync);

        await localEdit(editor, bufferSync);

        await bufferSync.listener!.onSave();
        await pollEqual(1000, "Hllo", () => fs.readFileSync(tmpFile.path, {flag:'r'}));
    }).timeout(5000);


    test("Test open remote file and send many changes", async () => {
        let editorSync = new MemoryEditorSync();
        await syncPortal.onOpenRemoteFile("peer","test.txt", vscode.Uri.parse("collabfs://memory/test.txt"),editorSync);
        await syncPortal.onActivateRemoveFile(editorSync);
        await syncConnection.shareRemoteToLocal.activateRemoteFile(syncPortal.cachesBySync.get(editorSync)!);
        let activeEditor = vscode.window.activeTextEditor;
        let bufferSync = (editorSync.getBufferSync() as MemoryBufferSync);
        let bufferListener =  bufferSync.listener!;
        bufferListener.onSetText("");
        await pollEqual(1000, "", () => activeEditor?.document.getText());
        bufferSync.localChanges = [];
        for(var i = 0;i<1000;i++) {
            await bufferListener.onTextChanges([new TextChange(TextChangeType.INSERT, new Position(0, 1), new Position(0, 1), "b"),new TextChange(TextChangeType.INSERT, new Position(0, 0), new Position(0, 0), "a")]);
        }
        assert.strictEqual(bufferSync.localChanges.length, 0);

    });
});

async function closeOpenWindows() {
    for (let editor of vscode.window.visibleTextEditors) {
        try {
            await vscode.window.showTextDocument(editor.document);
            vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        } catch (error) {
        }
    }
}

async function localEdit(editor: vscode.TextEditor, bufferSync: MemoryBufferSync) {
    await sleep(100);
    await editor.edit((editBuilder) => {
        editBuilder.insert(new vscode.Position(0, 1), "a");
    });
    await pollEqual(500, 1, () => bufferSync.localChanges.length);
    assert.deepStrictEqual(bufferSync.localChanges[0], new TextChange(TextChangeType.UPDATE, new Position(0, 1), new Position(0, 1), "a"));
    await editor.edit((editBuilder) => {
        editBuilder.replace(new vscode.Range(new vscode.Position(0, 1), new vscode.Position(0, 2)), "e");
    });
    await pollEqual(500, 2, () => bufferSync.localChanges.length);
    assert.deepStrictEqual(bufferSync.localChanges[1], new TextChange(TextChangeType.UPDATE, new Position(0, 1), new Position(0, 2), "e"));
    await editor.edit((editBuilder) => {
        editBuilder.delete(new vscode.Range(new vscode.Position(0, 1), new vscode.Position(0, 2)));
    });
    await pollEqual(500, 3, () => bufferSync.localChanges.length);
    assert.deepStrictEqual(bufferSync.localChanges[2], new TextChange(TextChangeType.UPDATE, new Position(0, 1), new Position(0, 2), ""));
}

async function remoteEdit(activeEditor: vscode.TextEditor | undefined, bufferListener: IBufferListener, bufferSync: MemoryBufferSync) {
    bufferSync.localChanges = [];
    await bufferListener.onTextChanges([new TextChange(TextChangeType.INSERT, new Position(0, 3), new Position(0, 3), "l")]);
    await pollEqual(1000, "Hallo", () => activeEditor?.document.getText());
    await bufferListener.onTextChanges([new TextChange(TextChangeType.UPDATE, new Position(0, 1), new Position(0, 2), "e")]);
    await pollEqual(1000, "Hello", () => activeEditor?.document.getText());
    await bufferListener.onTextChanges([new TextChange(TextChangeType.DELETE, new Position(0, 1), new Position(0, 2), "")]);
    await pollEqual(1000, "Hllo", () => activeEditor?.document.getText());

    assert.strictEqual(bufferSync.localChanges.length, 0);
}
