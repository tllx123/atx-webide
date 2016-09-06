/* utils functions */
function notify(message, className, position, element, autoHideDelay){
  className = className || 'info';
  position = position || 'top center';
  autoHideDelay = autoHideDelay || 1500;
  $.notify(message, {className, position, autoHideDelay});
}

/* Vue controls the layout */
Vue.config.delimiters = ['${', '}'];
var vm = new Vue({
  el: '#main-content',
  data: {
    tab: 'blocklyDiv',
    // choose device
    choosing: false,
    android_serial_choices: [],
    android_serial: '',
    ios_url: '',
    // device status
    device: {
      platform: 'android',
      serial: '',
      latest_screen: '',
    },
    // layout controls
    layout: {
      width: 1, //document.documentElement.clientWidth,
      height: 1, //document.documentElement.clientHeight,
      right_portion: 30, // max: 55, min: 25
      screen_ratio: 1.5, // screen height/width
      screen_scale: 0.4, // canvas width / screen width
    },
    // screen
    screen: null,
    refreshing: true, // should set to false after refreshScreen
    // blockly stuff
    blockly: {
      dirty: false, // has there any changes been made
      running: false,
      saving: false,
      xml: '',
      pythonText: '',
      pythonDebugText: '',
    },
    images: [],
    // screen overlays
    overlays: {
      selected: null,
      crop_bounds: {bound:null}, // null
      click_point: {}, // atx_click
      rect_bounds: {}, // atx_click_image
      swipe_points: {}, // atx_swipe
    },
  },
  computed: {
    canvas_width: function() {
      var margin = 30; // right 15 + left 15
      return (this.layout.width-2*margin) * this.layout.right_portion/100.0 - margin;
    },
    canvas_height: function() {
      canvas.width = this.canvas_width;
      canvas.height = this.canvas_width * this.layout.screen_ratio;
      if (this.screen) {
        var ctx = canvas.getContext('2d');
        ctx.drawImage(this.screen, 0, 0, canvas.width, canvas.height);
        this.layout.screen_scale = this.canvas_width/this.screen.width;
      }
      return canvas.height;
    },
  },
  methods: {
    switchTab: function(which) {
      if (which == this.tab) { return; }
      if (this.tab == 'blocklyDiv' && this.blockly.dirty) {this.saveWorkspace();}
      this.tab = which;
    },
    generateCode: function(){
      this.blockly.xml = Blockly.Xml.workspaceToDom(workspace);
      this.blockly.xmlText = Blockly.Xml.domToPrettyText(this.blockly.xml),
      Blockly.Python.STATEMENT_PREFIX = '';
      this.blockly.pythonText = Blockly.Python.workspaceToCode(workspace);
      Blockly.Python.STATEMENT_PREFIX = 'highlight_block(%1);\n';
      this.blockly.pythonDebugText = Blockly.Python.workspaceToCode(workspace);
      // highlight python code block
      this.$nextTick(function(){
        $("#python-code").text(this.blockly.pythonText);
        Prism.highlightAll();
      });
    },
    saveWorkspace: function(){
      if (!workspace) {return;}
      this.generateCode();
      var self = this;
      // save
      $.ajax({
        url: '/workspace',
        method: 'POST',
        data: {'xml_text': this.blockly.xmlText, 'python_text': this.blockly.pythonText},
        success: function(data){
          notify('保存成功', 'success');
          self.blockly.dirty = false;
        },
        error: function(e){
          console.log(e);
          notify(e.responseText || '保存失败，请检查服务器连接是否正常', 'warn');
        },
      });
    },
    runBlockly: function(){
      this.blockly.running = true;
      workspace.traceOn(true); // enable step run
      ws.send(JSON.stringify({command: "run", code:this.blockly.pythonDebugText}));
    },
    stopBlockly: function(){
      console.log('stop');
      ws.send(JSON.stringify({command: "stop", code:this.blockly.pythonDebugText}));
    },
    getDeviceChoices: function(){
      var self = this;
      $.ajax({
        url: '/device',
        method: 'GET',
        dataType: 'json',
        data: {
          platform: this.device.platform,
        },
        success: function(data){
          // clean old devices
          self.android_serial_choices.splice(0, self.android_serial_choices.length);
          for (var i = 0, s; i < data.android.length; i++) {
            s = data.android[i];
            self.android_serial_choices.push(s);
          }
          self.choosing = true;
        },
        error: function(err) {
          notify('获取设备列表失败', 'error');
          console.log(222, err);
        }
      });
    },
    connectDevice: function(){
      var serial = this.device.platform == 'ios' ? this.ios_url : this.android_serial;
      console.log("connecting", this.device.platform, serial);
      var self = this;
      $.ajax({
        url: '/device',
        method: 'POST',
        dataType: 'json',
        data: {
          serial: serial,
        },
        success: function(data){
          notify('连接成功, 刷新中..', 'success');
          self.choosing = false;
          self.refreshScreen();
        },
        error: function(err) {
          notify('连接失败', 'error');
          self.choosing = false;
        }
      });
    },
    cancelConnectDevice: function(){
      this.choosing = false;
    },
    openChooseDevice: function(){
      this.getDeviceChoices();
    },
    refreshScreen: function() {
      var url = '/images/screenshot?v=t' + new Date().getTime();
      this.loadScreen(url,
        function(){
          notify('Refresh Done.', 'success');
          ws.send(JSON.stringify({command: "refresh"}));},
        function(){ notify('Refresh Failed.', 'error');}
      );
    },
    loadScreen: function(url, callback, errback){
      if (!url || (this.screen && url == this.screen.src)) {return;}
      var img = new Image(),
          self = this;
      self.refreshing = true;
      img.crossOrigin = 'anonymous';
      img.addEventListener('load', function(){
        self.layout.screen_ratio = img.height / img.width;
        self.refreshing = false;
        self.screen = img;
        if (callback) { callback(); }
      });
      img.addEventListener('error', function(err){
        console.log('loadScreen', err);
        self.refreshing = false;
        if (errback) {errback(err);}
      });
      img.src = url;
    },
    saveScreenCrop: function() {
      if (this.device.latest_screen == '') {
        notify('图片列表尚未刷新!', 'warn');
        return;
      }
      var bound = this.overlays.crop_bounds.bound;
      if (bound === null) {
        notify('还没选择截图区域！', 'warn');
        return;
      }
      var filename = window.prompt('保存的文件名, 不需要输入.png扩展名');
      if (!filename){
        return;
      }
      filename = filename + '.png';
      var self = this;
      $.ajax({
        url: '/images/screenshot',
        method: 'POST',
        dataType: 'json',
        data: {
          screenname: self.device.latest_screen,
          filename: filename,
          bound: bound,
        },
        success: function(res){
          console.log(res)
          notify('图片保存成功', 'success');
          ws.send(JSON.stringify({command: "refresh"}));
          $('#screen-crop').css({'left':'0px', 'top':'0px','width':'0px', 'height':'0px'});
          self.overlays.crop_bounds.bound = null;
        },
        error: function(err){
          console.log(err)
          notify('图片保存失败，打开调试窗口查看具体问题', 'error');
        },
      });
    },
  },
  watch: {
    'tab': function(newVal, oldVal) {
      if (workspace) { Blockly.svgResize(workspace); }
    },
    'layout.right_portion': function(newVal, oldVal) {
      if (workspace) { Blockly.svgResize(workspace); }
    },
    'screen': function(newVal, oldVal) {
      var ctx = canvas.getContext('2d');
      ctx.drawImage(newVal, 0, 0, canvas.width, canvas.height);
    },
  },
});

/* workspace for Blockly */
var workspace;
/* screen canvas */
var canvas = document.getElementById('canvas');
/* websocket client for debug */
var ws;

/* init */
$(function(){

  function restoreWorkspace() {
    $.get('/workspace')
      .success(function(res){
        var xml = Blockly.Xml.textToDom(res.xml_text);
        workspace.clear(); // clear up before add
        Blockly.Xml.domToWorkspace(workspace, xml);
        vm.generateCode();
      })
      .error(function(res){
        alert(res.responseText);
      })
  }

  function connectWebsocket(){
    ws = new WebSocket('ws://'+location.host+'/ws')

    ws.onopen = function(){
      ws.send(JSON.stringify({command: "refresh"}))
      notify('与后台通信连接成功!!!');
      restoreWorkspace();
    };
    ws.onmessage = function(evt){
      try {
        var data = JSON.parse(evt.data)
        console.log(evt.data);
        switch(data.type){
        case 'open':
          vm.getDeviceChoices();
          break;
        case 'image_list':
          window.blocklyImageList = [];
          vm.images.splice(0, vm.images.length);
          for (var i = 0, info; i < data.images.length; i++) {
            info = data.images[i];
            window.blocklyImageList.push([info['name'], info['path']]);
            vm.images.push({name:info['name'], path:window.blocklyBaseURL+info['path']});
          }
          window.blocklyCropImageList = [];
          for (var i = 0, info; i < data.screenshots.length; i++) {
            info = data.screenshots[i]
            window.blocklyCropImageList.push([info['name'], info['path']]);
          }
          vm.device.latest_screen = data.latest;
          notify('图片列表已刷新', 'success');
          break;
        case 'run':
          if (data.status == 'ready') {
            vm.blockly.running = false;
          }
          if (data.notify) {notify(data.notify);}
          break;
        case 'stop':
          break;
        case 'traceback':
          alert(data.output);
          break;
        case 'highlight':
          var id = data.id;
          workspace.highlightBlock(id)
          break;
        case 'console':
          var $console = $('pre.console');
          var text = $console.html();
          $console.text($console.html() + data.output);
          $console.scrollTop($console.prop('scrollHeight'));
          break;
        default:
          console.log("No match data type: ", data.type)
        }
      }
      catch(err){
        console.log(err, evt.data)
      }
    };
    ws.onerror = function(err){
      // $.notify(err);
      // console.error(err)
    };
    ws.onclose = function(){
      console.log("Closed");
      notify('与后台通信连接断开, 2s钟后重新连接 !!!', 'error');
      setTimeout(function(){
        connectWebsocket()
      }, 2000)
    };
  }

  /************************* init here *************************/

  // Initial global value for blockly images
  window.blocklyBaseURL = 'http://'+ location.host +'/static_imgs/';
  window.blocklyImageList = null;
  window.blocklyCropImageList = null;
  Blockly.Python.addReservedWords('highlight_block');
  workspace = Blockly.inject(document.getElementById('blocklyDiv'),
                    {toolbox: document.getElementById('toolbox')});

  var screenURL = '/images/screenshot?v=t' + new Date().getTime();

  // listen resize event
  function onResize(){
    vm.layout.width = document.documentElement.clientWidth;
    vm.layout.height = document.documentElement.clientHeight;
    var blocklyDivHeight = vm.layout.height - $("#blocklyDiv").offset().top;
    var consoleHeight = $('#left-panel>div:last').height();
    $('#blocklyDiv').height(Math.max(300, blocklyDivHeight-consoleHeight-20));
    Blockly.svgResize(workspace);
  }
  window.addEventListener('resize', onResize, false);
  onResize();

  // WebSocket for debug
  connectWebsocket()

  //------------------------ canvas overlays --------------------------//

  function getMousePos(canvas, evt) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: Math.floor((evt.clientX - rect.left) / vm.layout.screen_scale),
      y: Math.floor((evt.clientY - rect.top) / vm.layout.screen_scale),
    };
  }

  function getCanvasPos(x, y) {
      var left = vm.layout.screen_scale * x,
          top  = vm.layout.screen_scale * y;
      return {left, top};
  }

  var overlays = {
    "atx_click" : {
      $el: $('<div>').addClass('point').hide().appendTo('#screen-overlays'),
      update: function(data){
        var pos = getCanvasPos(data.x, data.y);
        this.$el.css('left', pos.left+'px')
                .css('top', pos.top+'px');
      },
    },
    "atx_click_image" : {
      $el: $('<div>').addClass('image-rect').hide().appendTo('#screen-overlays')
          .append($('<div>').addClass('point')),
      update: function(data){
        var p1 = getCanvasPos(data.x1, data.y1),
            p2 = getCanvasPos(data.x2, data.y2),
            width = p2.left - p1.left,
            height = p2.top - p1.top;
        this.$el.css('left', p1.left+'px')
                .css('top', p1.top+'px')
                .css('width', width+'px')
                .css('height', height+'px');
        this.$el.children().css('left', (data.c.x+50)+'%').css('top', (data.c.y+50)+'%');
      },
    },
    "atx_click_ui" : {
      $el: $('<div>').addClass('ui-rect').hide().appendTo('#screen-overlays'),
      update: function(data){
        var p1 = getCanvasPos(data.x1, data.y1),
            p2 = getCanvasPos(data.x2, data.y2),
            width = p2.left - p1.left,
            height = p2.top - p1.top;
        this.$el.css('left', p1.left+'px')
                .css('top', p1.top+'px')
                .css('width', width+'px')
                .css('height', height+'px');
      },
    },
    "atx_swipe" : {
      $el: $('#overlays-swipe').addClass('full').hide(),
      update: function(data){
        var p1 = getCanvasPos(data.x1, data.y1),
            p2 = getCanvasPos(data.x2, data.y2);
        var $svg = this.$el.children('svg'),
            cstart = '<circle cx="'+p1.left+'" cy="'+p1.top+'" fill="black" r="3"></circle>'
            cend = '<circle cx="'+p2.left+'" cy="'+p2.top+'" fill="white" r="3"></circle>'
            line = '<line stroke="black" stroke-width="2"' +
                   ' x1="'+p1.left+'" y1="'+p1.top +
                   '" x2="'+p2.left+'" y2="'+p2.top+'"></line>';
        $svg.html(cstart + line + cend);
      },
    },
  };

  //------------ canvas do different things for different block ------------//

  // -------- selected is null, used for save screen crop -------
  var crop_bounds = {start: null, end: null, bound:null},
      crop_rect_bounds = {start:null, end:null, bound:null},
      draw_rect = false;

  // Alt: 18, Ctrl: 17, Shift: 16
  // $('body').on('keydown', function(evt){
  //   if (true || evt.keyCode != 18) {return;}
  //   draw_rect = true;
  //   crop_bounds.start = crop_bounds.end = crop_bounds.bound = null;
  //   // $("#screen-crop").css({'left':'0px', 'top':'0px', 'width':'0px', 'height':'0px'});
  // });
  // $('body').on('keyup', function(evt){
  //   if (evt.keyCode != 18) {return;}
  //   draw_rect = false;
  //   crop_rect_bounds.start = crop_rect_bounds.end = crop_rect_bounds.bound = null;
  //   // $("#screen-crop-rect").css({'left':'0px', 'top':'0px', 'width':'0px', 'height':'0px'});
  // });

  canvas.addEventListener('mousedown', function(evt){
    var blk = Blockly.selected;
    if (blk !== null) {
      return;
    }
    if (draw_rect) {
      crop_rect_bounds.start = evt;
      crop_rect_bounds.end = null;
    } else {
      crop_bounds.start = evt;
      crop_bounds.end = null;
    }
  });
  canvas.addEventListener('mousemove', function(evt){
    // ignore fake move
    if (evt.movementX == 0 && evt.movementY == 0) {
      return;
    }
    var blk = Blockly.selected;
    if (blk !== null || (crop_bounds.start == null && crop_rect_bounds.start == null)) {
      return;
    }
    var rect = canvas.getBoundingClientRect(),
        $rect, bounds;
    if (draw_rect) {
      crop_rect_bounds.end = evt;
      bounds = crop_rect_bounds;
      $rect = $("#screen-crop-rect");
    } else {
      crop_bounds.end = evt;
      bounds = crop_bounds;
      $rect = $("#screen-crop");
    }
    // update rect position
    var left = bounds.start.pageX - rect.left,
        top = bounds.start.pageY - rect.top,
        width = Math.max(bounds.end.pageX - bounds.start.pageX, 10),
        height = Math.max(bounds.end.pageY - bounds.start.pageY, 10);
    $rect.show();
    $rect.css('left', left+'px')
         .css('top', top+'px')
         .css('width', width+'px')
         .css('height', height+'px');
  });
  canvas.addEventListener('mouseup', function(evt){
    var blk = Blockly.selected;
    if (blk !== null) {
      return;
    }
    if  (crop_bounds.end !== null) {
      var start = getMousePos(canvas, crop_bounds.start),
          end = getMousePos(canvas, crop_bounds.end);
      crop_bounds.bound = [start.x, start.y, end.x, end.y];
      vm.overlays.crop_bounds.bound = [start.x, start.y, end.x, end.y];
    }
    crop_bounds.start = null;
    crop_rect_bounds.start = null;
  });
  canvas.addEventListener('mouseout', function(evt){
    var blk = Blockly.selected;
    if (blk !== null) {
      return;
    }
    if  (crop_bounds.start !==null && crop_bounds.end !== null) {
      var start = getMousePos(canvas, crop_bounds.start),
          end = getMousePos(canvas, crop_bounds.end);
      crop_bounds.bound = [start.x, start.y, end.x, end.y];
      vm.overlays.crop_bounds.bound = [start.x, start.y, end.x, end.y];
    }
    crop_bounds.start = null;
    crop_rect_bounds.start = null;
  });

  // -------- selected is atx_click ----------
  canvas.addEventListener('click', function(evt){
    var blk = Blockly.selected;
    if (blk == null || blk.type != 'atx_click') {
      return;
    }
    // update model in blockly
    var pos = getMousePos(this, evt);
    var rect = canvas.getBoundingClientRect();
    blk.setFieldValue(pos.x, 'X');
    blk.setFieldValue(pos.y, 'Y');
    // update point position
    var $point = overlays['atx_click'].$el;
    $point.css('left', (evt.pageX-rect.left)+'px').css('top', (evt.pageY-rect.top)+'px');
  });

  // --------- selected is atx_click_image ------------
  var rect_bounds = {start: null, end: null};
  canvas.addEventListener('mousedown', function(evt){
    var blk = Blockly.selected;
    if (blk == null || blk.type != 'atx_click_image') {
      return;
    }
    rect_bounds.start = evt;
    rect_bounds.end = null;
  });
  canvas.addEventListener('mousemove', function(evt){
    // ignore fake move
    if (evt.movementX == 0 && evt.movementY == 0) {
      return;
    }
    var blk = Blockly.selected;
    if (blk == null || blk.type != 'atx_click_image' || rect_bounds.start == null) {
      return;
    }
    rect_bounds.end = evt;
    // update model in blockly
    var pat_conn = blk.getInput('ATX_PATTERN').connection.targetConnection;
    if (pat_conn == null) { return;}
    var pat_blk = pat_conn.sourceBlock_;
    if (pat_blk.type != 'atx_image_pattern_offset') {return;}
    var img_conn = pat_blk.getInput('FILENAME').connection.targetConnection;
    if (img_conn == null) { return;}
    var img_blk = img_conn.sourceBlock_;
    if (img_blk.type != 'atx_image_crop_preview') {return; }
    var crop_conn = img_blk.getInput('IMAGE_CROP').connection.targetConnection;
    if (crop_conn == null) { return;}
    var crop_blk = crop_conn.sourceBlock_,
        start_pos = getMousePos(this, rect_bounds.start),
        end_pos = getMousePos(this, rect_bounds.end);
    crop_blk.setFieldValue(start_pos.x, 'LEFT');
    crop_blk.setFieldValue(start_pos.y, 'TOP');
    crop_blk.setFieldValue(end_pos.x - start_pos.x, 'WIDTH');
    crop_blk.setFieldValue(end_pos.y - start_pos.y, 'HEIGHT');
    pat_blk.setFieldValue(0, 'OX');
    pat_blk.setFieldValue(0, 'OY');

    // update image-rect position
    var $rect = overlays['atx_click_image'].$el,
        rect = canvas.getBoundingClientRect(),
        left = rect_bounds.start.pageX,
        top = rect_bounds.start.pageY,
        width = Math.max(rect_bounds.end.pageX - left, 10),
        height = Math.max(rect_bounds.end.pageY - top, 10);
    $rect.css('left', (left-rect.left)+'px')
         .css('top', (top-rect.top)+'px')
         .css('width', width+'px')
         .css('height', height+'px');
    $rect.children().css('left', '50%').css('top', '50%');
  });
  canvas.addEventListener('mouseup', function(evt){
    var blk = Blockly.selected;
    // mouseup event should only be triggered when there happened mousemove
    if (blk == null || blk.type != 'atx_click_image' || rect_bounds.end == null) {
      return;
    }
    rect_bounds.start = null;
  });
  canvas.addEventListener('mouseout', function(evt){
    var blk = Blockly.selected;
    // mouseout is same as mouseup
    if (blk == null || blk.type != 'atx_click_image' || rect_bounds.end == null) {
      return;
    }
    rect_bounds.start = null;
  });
  canvas.addEventListener('click', function(evt){
    var blk = Blockly.selected;
    // click event should only be triggered when there's no mousemove happened.
    if (blk == null || blk.type != 'atx_click_image' || rect_bounds.end != null) {
      return;
    }
    rect_bounds.start = null;
    // update model in blockly
    var pat_conn = blk.getInput('ATX_PATTERN').connection.targetConnection;
    if (pat_conn == null) { return;}
    var pat_blk = pat_conn.sourceBlock_;
    if (pat_blk.type !== 'atx_image_pattern_offset') {return;}

    // update image-rect point position
    var $rect = overlays['atx_click_image'].$el,
        pos = $rect.position(),
        x = pos.left,
        y = pos.top,
        w = $rect.width(),
        h = $rect.height(),
        cx = x + w/2,
        cy = y + h/2,
        ox = parseInt((evt.pageX - cx)/w * 100),
        oy = parseInt((evt.pageY - cy)/h * 100),
        $point = $rect.children();
    pat_blk.setFieldValue(ox, 'OX');
    pat_blk.setFieldValue(oy, 'OY');
    $point.css('left', (50+ox)+'%').css('top', (50+oy)+'%');
  });

  // TODO ------------ selected is atx_click_ui ------------
  // canvas.addEventListener('click', function(evt){
  //   var blk = Blockly.selected;
  //   if (blk == null || blk.type != 'atx_click_ui') { return; }
  // });

  // ------------ selected is atx_swipe -----------
  var swipe_points = {start:null, end:null};
  canvas.addEventListener('mousedown', function(evt){
    var blk = Blockly.selected;
    if (blk == null || blk.type != 'atx_swipe') { return; }
    swipe_points.start = evt;
    swipe_points.end = null;
  });
  canvas.addEventListener('mousemove', function(evt){
    if (evt.movementX == 0 && evt.movementY == 0) { return; }
    var blk = Blockly.selected;
    if (blk == null || blk.type != 'atx_swipe' || swipe_points.start == null) { return; }
    swipe_points.end = evt;
    var spos = getMousePos(this, swipe_points.start),
        epos = getMousePos(this, swipe_points.end);
        p1 = getCanvasPos(spos.x, spos.y),
        p2 = getCanvasPos(epos.x, epos.y);
    // update blockly model
    blk.setFieldValue(spos.x, 'SX');
    blk.setFieldValue(spos.y, 'SY');
    blk.setFieldValue(epos.x, 'EX');
    blk.setFieldValue(epos.y, 'EY');
    // update line
    var $svg = $("#overlays-swipe").children('svg'),
        cstart = '<circle cx="'+p1.left+'" cy="'+p1.top+'" fill="black" r="3"></circle>'
        cend = '<circle cx="'+p2.left+'" cy="'+p2.top+'" fill="white" r="3"></circle>'
        line = '<line stroke="black" stroke-width="2"' +
               ' x1="'+p1.left+'" y1="'+p1.top +
               '" x2="'+p2.left+'" y2="'+p2.top+'"></line>';
    $svg.html(cstart + line + cend);
  });
  canvas.addEventListener('mouseup', function(evt){
    var blk = Blockly.selected;
    if (blk == null || blk.type != 'atx_swipe') { return; }
    swipe_points.start = null;
    swipe_points.end = null;
  });
  canvas.addEventListener('mouseout', function(evt){
    var blk = Blockly.selected;
    if (blk == null || blk.type != 'atx_swipe') { return; }
    swipe_points.start = null;
    swipe_points.end = null;
  });

  //------------ canvas show rect/points for special block ------------//
  function getBlockOverlayData(blk) {
    switch (blk.type) {
      // return {x, y}
      case 'atx_click':
        var x = parseInt(blk.getFieldValue('X')),
            y = parseInt(blk.getFieldValue('Y'));
        if (x != null && y != null) {
          return {x, y};
        } else {
          return null;
        }
      // return {x1, y1, x2, y2, c}
      case 'atx_click_image':
        var pat_conn = blk.getInput('ATX_PATTERN').connection.targetConnection;
        if (pat_conn == null) { return null;}
        var pat_blk = pat_conn.sourceBlock_;
        if (pat_blk.type != 'atx_image_pattern_offset') {return null;}
        var img_conn = pat_blk.getInput('FILENAME').connection.targetConnection;
        if (img_conn == null) { return null;}
        var img_blk = img_conn.sourceBlock_;
        if (img_blk.type != 'atx_image_crop_preview') {return null;}
        var crop_conn = img_blk.getInput('IMAGE_CROP').connection.targetConnection;
        if (crop_conn == null) { return null;}
        var imagename = img_blk.getFieldValue('IMAGE'),
            crop_blk = crop_conn.sourceBlock_,
            left = parseInt(crop_blk.getFieldValue('LEFT')),
            top = parseInt(crop_blk.getFieldValue('TOP')),
            width = parseInt(crop_blk.getFieldValue('WIDTH')),
            height = parseInt(crop_blk.getFieldValue('HEIGHT')),
            ox = parseInt(pat_blk.getFieldValue('OX')),
            oy = parseInt(pat_blk.getFieldValue('OY'));
            return {x1: left, y1: top, x2: left+width, y2: top+height, c:{x:ox, y:oy}};
      // TODO return {x1, y1, x2, y2}
      case 'atx_click_ui':
      // return {x1, y1, x2, y2}
      case 'atx_swipe':
        var x1 = parseInt(blk.getFieldValue('SX')),
            y1 = parseInt(blk.getFieldValue('SY')),
            x2 = parseInt(blk.getFieldValue('EX')),
            y2 = parseInt(blk.getFieldValue('EY'));
            return {x1, y1, x2, y2};
      default:
        return null;
    }
  }

  function hideOverlayPart(type) {
    if (!overlays.hasOwnProperty(type)) {return;}
    var obj = overlays[type];
    obj.$el.hide();
  }

  function showOverlayPart(type, blk) {
    if (!overlays.hasOwnProperty(type)) {return;}
    var obj = overlays[type];
    var data = getBlockOverlayData(blk)
    if (data != null) {
      obj.update(data);
      obj.$el.show();
    }
  }

  function onUISelectedChange(evt){
    if (evt.type != Blockly.Events.UI || evt.element != 'selected') {return;}
    if (evt.oldValue != null) {
      var oldblk = workspace.getBlockById(evt.oldValue);
      if (oldblk === null) { return;}
      hideOverlayPart(oldblk.type);
    } else {
      $('#screen-crop').hide();
      $('#btn-save-screen').attr('disabled', 'disabled');
    }
    if (evt.newValue != null) {
      var newblk = workspace.getBlockById(evt.newValue);
      showOverlayPart(newblk.type, newblk);
      useBlockScreen(newblk);
    } else {
      useBlockScreen();
      crop_bounds.bound = null;
      $('#screen-crop').css({'left':'0px', 'top':'0px',
          'width':'0px', 'height':'0px'}).show();
      $('#btn-save-screen').removeAttr('disabled');
    }
  }
  workspace.addChangeListener(onUISelectedChange);

  // track screenshot related to each block
  var block_screen = {};
  function useBlockScreen(blk) {
    var conn;
    if (blk && blk.type == 'atx_click_image') {
      conn = blk.getInput('ATX_PATTERN').connection.targetConnection;
      blk = conn && conn.sourceBlock_;
    }
    if (blk && blk.type == 'atx_image_pattern_offset') {
      conn = blk.getInput('FILENAME').connection.targetConnection;
      blk = conn && conn.sourceBlock_;
    }
    if (blk && blk.type == 'atx_image_crop_preview') {
      conn = blk.getInput('IMAGE_CROP').connection.targetConnection;
      blk = conn && conn.sourceBlock_;
    }
    var screen = blk && block_screen[blk.id] || vm.device.latest_screen,
        url = window.blocklyBaseURL + screen;
    vm.loadScreen(url);
  }

  function onUIFieldChange(evt) {
    if (evt.type != Blockly.Events.CHANGE || evt.element != 'field') {return;}
    vm.blockly.dirty = true;
    var blk = workspace.getBlockById(evt.blockId);
    if (blk.type == 'atx_image_crop' && evt.name == 'FILENAME') {
      block_screen[evt.blockId] = evt.newValue;
    }
  }
  function onCreateBlock(evt){
    if (evt.type != Blockly.Events.CREATE) {return;}
    vm.blockly.dirty = true;
    for (var i = 0, bid; i < evt.ids.length; i++) {
      bid = evt.ids[i];
      var blk = workspace.getBlockById(bid);
      if (blk.type == 'atx_image_crop') {
        block_screen[bid] = blk.getFieldValue('FILENAME');
      }
    }
  }
  function onDeleteBlock(evt){
    if (evt.type != Blockly.Events.DELETE) {return;}
    vm.blockly.dirty = true;
    for (var i = 0, bid; i < evt.ids.length; i++) {
      bid = evt.ids[i];
      delete block_screen[bid];
    }
  }
  function onBlockConnectionChange(evt) {
    if (evt.type != Blockly.Events.MOVE && !evt.oldParentId && !evt.newParentId) {
      return;
    }
    vm.blockly.dirty = true;
    var oldblk = evt.oldParentId ? workspace.getBlockById(evt.oldParentId) : null,
        newblk = evt.newParentId ? workspace.getBlockById(evt.newParentId) : null;
    if (oldblk) {

    }
    if (newblk) {

    }
  }
  workspace.addChangeListener(onCreateBlock);
  workspace.addChangeListener(onDeleteBlock);
  workspace.addChangeListener(onUIFieldChange);
  workspace.addChangeListener(onBlockConnectionChange);

  /*--------------- resize handle ----------------*/
  function setupResizeHandle(){
    $('#resize-handle').on('drag', function(evt){
      var x = evt.originalEvent.pageX;
      if (x <= 0) { return; }
      var p = 1 - (evt.originalEvent.pageX - 30)/(vm.layout.width-60);
      vm.layout.right_portion = Math.min(55, Math.max(parseInt(p*100), 25));
      vm.layout.width = document.documentElement.clientWidth;
    });
  }
  setupResizeHandle();
})
