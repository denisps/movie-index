const child_process = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

var send = require('send');

var UniQue = function() {
    this.uni = {};
    this.que = [];
};

UniQue.prototype.add = function(data) {
    var time = Date.now();
    if(!this.uni[data] || time > this.uni[data]) {
        this.uni[data] = time + 100*60*1000;
        this.que.push(data);
    }
}

UniQue.prototype.process = function() {
    return this.que.shift();
}

UniQue.prototype.remove = function(data) {
    this.uni[data] = Date.now() + 10*60*1000;
}

var stats = [];
var thumbque = new UniQue();
var downloads = {};
var media = {};

function thumnail() {
    var file = thumbque.process();
    if (file) {
        var cmd = 'u:/ffmpeg -ss 00:00:50 -i "' + file + '" -y -vf '
				+ 'scale=w=300:h=168:force_original_aspect_ratio=decrease "' + file + '.thumbnail.jpg" ';
        console.log(cmd);
        child_process.exec(cmd, { windowsHide: true }, function(error){
			if (error) {
				fs.copyFile('thumbnail.jpg', file + '.thumbnail.jpg', function() {
					thumbque.remove(file);
				});
				console.log('Could not create thumbnail for ' + file);
			} else {
				thumbque.remove(file);
			}
        //	// Next
            setTimeout(thumnail, 100);
        });
    } else {
        // Empty
        setTimeout(thumnail, 100);
    }
}

function statfiles(folder, files, i, stats, callback) {
    if (files && i < files.length) {
        fs.stat(path.join(folder, files[i]), function(err, stat) {
            if (stat) {
                stats[path.join(folder, files[i])] = stat;
            }
            statfiles(folder, files, i + 1, stats, callback);
        });
    } else {
        callback(stats);
    }
}

function readdirs(dirs, callback, stats) {
    if (dirs.length)
        fs.readdir(dirs[0], function(err, files) {
            statfiles(dirs[0], files, 0, stats, function() {
                readdirs(dirs.slice(1), callback, stats);
            });
        });
    else
        callback(stats);
}

function scanfolder(list, folders, depth, callback) {
    if (callback === true) { // Rerun
            callback = function() {
                setTimeout(function() {
                    scanfolder(list, folders, depth, true);
                    for (var file in stats) {
                        fs.stat(file, function(err, stat) {
                            if (!stat.isFile()) {
                                delete stats[file];
                            }
                        });
                    }
                }, 10000);
            }
    }
    readdirs(folders, function(stats) {
        dirs = [];
	    var past10min = Date.now() - 10 * 60 * 1000;
        for (var file in stats) {
            var stat = stats[file];
            if (!file.match(/\/\./) && stat.isDirectory()) {
                dirs.push(file);
                //console.log(file);
            } else if (file.match(/\.(avi|mp4|mov|mpg|mpeg|avc|m2v|m4v|m3v|ts|wmv|mkv|mk3d)$/i)
                && !file.match(/(\Wsample\W|RARBG\.com)/i)
            ) {
                list[file] = stat.mtimeMs;
				// If file is at least 10 min old
				// 	If thumb does not exist - thumb === undefined
				// 	Or if thumb is empty - size = 0
				//	Or thumb is older than file
				if (stat.mtimeMs < past10min) {
					var thumb = stats[file + '.thumbnail.jpg'];
					if (thumb === undefined) {
						console.log('No thumbneil for: ' + file);
						thumbque.add(file);
					} else if (stat.mtimeMs > thumb.mtimeMs) {
						console.log('Thumbneil is too old: ' + file);
						thumbque.add(file);
					} else if (thumb.size == 0) {
						console.log('Thumbneil is empty: ' + file);
						thumbque.add(file);
					}
				}
            }
        }
        if (dirs.length) {
            scanfolder(list, dirs, depth - 1, callback);
        } else if (callback) {
            console.log('rerun');
            callback();
        }
    }, {});
}

console.log('thumbnails');
thumnail();
thumnail();
thumnail();
thumnail();

scanfolder(media = { }, ['Drives/'], 4, false);
scanfolder(downloads = { }, ['Downloads/'], 3, true);

function toURI(path) {
	console.log(path);
	return path.replace(/[^a-z0-9\/. ]/ig, function(x){
		return '$' + x.charCodeAt(0).toString(16) + '$'
	}).replace(/[ ]/g, '_')
}

function fromURI(uri) {
    let with_spaces = uri.replace(/[_]/g, ' ');
	return with_spaces.replace(/(?:\$|%24)([^\$]+)(?:\$|%24)/g, function(x, p1){
		return String.fromCharCode(parseInt(p1, 16))
    });
}

function filesToJs(stats) {
    var s = [];
	  for (var i in stats) {
      var stat = stats[i];
      for (var file in stat) {
              s.push({ name: toURI(file.replace(/\\/g, '/')), time: stat[file] });
      }
    }
	return JSON.stringify(s);
}

function handleHTTP(req, res) {
    var file = fromURI(req.url);
    console.log(file);
    if (file == '/mymoviescript.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end('files = ' + filesToJs([downloads, media]) + ';makeLinks(files, byTime);');
    } else {
        send()
		var snd = send(req, file, { index: false, dotfiles: 'allow'});
        snd.on('error', function printError(err){
            console.log(err);
            res.statusCode = err.status || 500;
            res.end(err.message);
        });
        
	    snd.pipe(res);
    }
}

process.on('uncaughtException', (error)  => {
    console.log('Oh my god, something terrible happend: ',  error);
});

http.createServer(handleHTTP).listen(8000);
